using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class BuildingEditorApiTests
{
    [Fact]
    public async Task SimulatedMutationAndBuildingViewUseTheSameConnectorState()
    {
        ControlTestDatabase.Reset();
        using var server = await StartServer("Development", allowMutations: true);
        using var client = new HttpClient { BaseAddress = server.Address };
        var before = JsonNode.Parse(await client.GetStringAsync("/api/building-view"))!;
        var roomId = before["controllers"]![0]!["rooms"]![0]!["id"]!.GetValue<string>();
        using var response = await client.PostAsync($"/api/rooms/{roomId}/sensor/trigger", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var returned = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        var view = JsonNode.Parse(await client.GetStringAsync("/api/building-view"))!;
        var controllerId = returned["id"]!.GetValue<string>();
        var observed = view["controllers"]!.AsArray()
            .Single(controller => controller!["id"]!.GetValue<string>() == controllerId);
        Assert.True(JsonNode.DeepEquals(returned, observed));
        Assert.True(observed!["rooms"]!.AsArray()
            .Single(room => room!["id"]!.GetValue<string>() == roomId)!["presence"]!.GetValue<bool>());
        Assert.Equal(view["design"]!["revision"]!.GetValue<long>(),
            JsonNode.Parse(await client.GetStringAsync("/api/controller-snapshot"))!["revision"]!.GetValue<long>());
    }

    [Fact]
    public async Task DefaultDesignReturnsSeedWithoutChangingSavedOrRunningState()
    {
        ControlTestDatabase.Reset();
        var store = new BuildingDesignStore(ControlTestDatabase.ConnectionString);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Width = 25 });
        Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
        Assert.Equal(BuildingDesignStoreStatus.Success, store.ActivateSaved(saved.Snapshot.Saved.Revision).Status);

        using var server = await StartServer("Development");
        using var client = new HttpClient { BaseAddress = server.Address };
        var beforeEditor = await client.GetStringAsync("/api/building-editor");
        var beforeView = await client.GetStringAsync("/api/building-view");
        using var response = await client.GetAsync("/api/building-editor/default-design");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var actual = JsonNode.Parse(await response.Content.ReadAsStringAsync());
        var expected = JsonSerializer.SerializeToNode(BuildingDesignSeed.Create(),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.True(JsonNode.DeepEquals(expected, actual));
        Assert.Equal(4, actual!["floors"]!.AsArray().Count);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(beforeEditor),
            JsonNode.Parse(await client.GetStringAsync("/api/building-editor"))));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(beforeView),
            JsonNode.Parse(await client.GetStringAsync("/api/building-view"))));
        Assert.Equal(25, store.Read().Saved.Width);
        Assert.Equal(25, store.Read().Active.Width);

        using var forwarded = new HttpRequestMessage(HttpMethod.Get, "/api/building-editor/default-design");
        forwarded.Headers.Add("X-Forwarded-For", "127.0.0.1");
        using var denied = await client.SendAsync(forwarded);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }

    [Fact]
    public async Task DefaultDesignIsForbiddenOutsideDevelopment()
    {
        ControlTestDatabase.Reset();
        using var server = await StartServer("Production");
        using var client = new HttpClient { BaseAddress = server.Address };
        using var response = await client.GetAsync("/api/building-editor/default-design");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static async Task<TestServer> StartServer(string environment, bool allowMutations = false)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.ArgumentList.Add(typeof(BuildingEditorService).Assembly.Location);
        start.ArgumentList.Add("--urls");
        start.ArgumentList.Add("http://127.0.0.1:0");
        start.Environment["ASPNETCORE_ENVIRONMENT"] = environment;
        start.Environment["ConnectionStrings__Control"] = ControlTestDatabase.ConnectionString;
        start.Environment["Simulator__AllowHttpMutations"] = allowMutations ? "true" : "false";
        start.Environment["Mqtt__Host"] = "127.0.0.1";
        start.Environment["Mqtt__Port"] = "0";
        start.Environment["Logging__LogLevel__Microsoft.Hosting.Lifetime"] = "Information";
        var process = Process.Start(start)!;
        process.BeginErrorReadLine();
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            while (await process.StandardOutput.ReadLineAsync(timeout.Token) is { } line)
            {
                const string marker = "Now listening on: ";
                var index = line.IndexOf(marker, StringComparison.Ordinal);
                if (index >= 0)
                    return new TestServer(process, new Uri(line[(index + marker.Length)..]));
            }
            throw new InvalidOperationException("Simulator exited before starting.");
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            process.Dispose();
            throw;
        }
    }

    private sealed class TestServer(Process process, Uri address) : IDisposable
    {
        public Uri Address { get; } = address;

        public void Dispose()
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            process.WaitForExit();
            process.Dispose();
        }
    }
}

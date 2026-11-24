using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class BuildingEditorApiTests
{
    [Fact]
    public async Task DefaultDesignReturnsSeedWithoutChangingSavedOrRunningState()
    {
        var path = Path.GetFullPath($"building-editor-api-{Guid.NewGuid():N}.db");
        try
        {
            var store = new BuildingDesignStore(path);
            var initial = store.Read();
            var saved = store.Save(initial.EditRevision, initial.Saved with { Width = 25 });
            Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
            Assert.Equal(BuildingDesignStoreStatus.Success, store.ActivateSaved(saved.Snapshot.Saved.Revision).Status);

            using var server = await StartServer(path, "Development");
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
        finally
        {
            DeleteDatabase(path);
        }
    }

    [Fact]
    public async Task DefaultDesignIsForbiddenOutsideDevelopment()
    {
        var path = Path.GetFullPath($"building-editor-api-{Guid.NewGuid():N}.db");
        try
        {
            using var server = await StartServer(path, "Production");
            using var client = new HttpClient { BaseAddress = server.Address };
            using var response = await client.GetAsync("/api/building-editor/default-design");
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        finally
        {
            DeleteDatabase(path);
        }
    }

    private static async Task<TestServer> StartServer(string path, string environment)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.ArgumentList.Add(typeof(BuildingDesign).Assembly.Location);
        start.ArgumentList.Add("--urls");
        start.ArgumentList.Add("http://127.0.0.1:0");
        start.Environment["ASPNETCORE_ENVIRONMENT"] = environment;
        start.Environment["BuildingDesign__SqlitePath"] = path;
        start.Environment["Simulator__AllowHttpMutations"] = "false";
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

    private static void DeleteDatabase(string path)
    {
        File.Delete(path);
        File.Delete(path + "-wal");
        File.Delete(path + "-shm");
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

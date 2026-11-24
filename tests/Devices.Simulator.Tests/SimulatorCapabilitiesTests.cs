using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

public class SimulatorCapabilitiesTests
{
    [Theory]
    [InlineData(false, "Development", false, false)]
    [InlineData(true, "Development", true, true)]
    [InlineData(true, "Production", true, false)]
    public async Task GetReturnsDeploymentCapabilitiesAndPreventsCaching(
        bool allowMutations, string environment, bool expectedMutations, bool expectedEditor)
    {
        await using var app = CreateApp(allowMutations, environment);
        await app.StartAsync();
        using var client = CreateClient(app);
        using var response = await client.GetAsync("/api/capabilities");
        response.EnsureSuccessStatusCode();
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.True(response.Headers.CacheControl?.NoStore);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(2, json.RootElement.EnumerateObject().Count());
        Assert.Equal(expectedMutations, json.RootElement.GetProperty("mutationsAllowed").GetBoolean());
        Assert.Equal(expectedEditor, json.RootElement.GetProperty("editorAllowed").GetBoolean());
    }

    [Fact]
    public async Task GetDoesNotAdvertiseWritableAccessForForwardedRequests()
    {
        await using var app = CreateApp(true, "Development");
        await app.StartAsync();
        using var client = CreateClient(app);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/capabilities");
        request.Headers.Add("X-Forwarded-Host", "localhost");
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.CacheControl?.NoStore);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(json.RootElement.GetProperty("mutationsAllowed").GetBoolean());
        Assert.False(json.RootElement.GetProperty("editorAllowed").GetBoolean());
    }

    private static WebApplication CreateApp(bool allowMutations, string environment)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = environment });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();
        SimulatorCapabilities.Map(app, allowMutations);
        return app;
    }

    private static HttpClient CreateClient(WebApplication app)
    {
        var address = app.Services.GetRequiredService<IServer>().Features
            .Get<IServerAddressesFeature>()!.Addresses.Single();
        return new HttpClient { BaseAddress = new Uri(address) };
    }
}

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

public class ProxyDevelopmentAccessPolicyTests
{
    private const string Secret = "local-proxy-secret";

    [Fact]
    public void AllowsAuthenticatedSameOriginDevelopmentRequests()
    {
        var context = CreateContext("POST");
        context.Request.Headers.Origin = "http://localhost:5080";
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";

        Assert.True(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
    }

    [Fact]
    public void RejectsDirectRequestsWrongSecretsAndNonDevelopment()
    {
        var context = CreateContext("GET");
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, false));
        context.Request.Headers.Remove(ProxyDevelopmentAccessPolicy.SecretHeader);
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
        context.Request.Headers[ProxyDevelopmentAccessPolicy.SecretHeader] = "wrong";
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
    }

    [Theory]
    [InlineData("http://attacker.example")]
    [InlineData("http://localhost:5081")]
    [InlineData("null")]
    public void RejectsCrossOriginOrOriginlessMutations(string origin)
    {
        var context = CreateContext("POST");
        context.Request.Headers.Origin = origin;
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
        context.Request.Headers.Remove("Origin");
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
    }

    [Fact]
    public void RejectsSpoofedHostForwardingAndCrossSiteRequests()
    {
        var context = CreateContext("GET");
        context.Request.Host = new HostString("attacker.example", 5080);
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
        context.Request.Host = new HostString("localhost", 5080);
        context.Request.Headers["X-Forwarded-Host"] = "localhost";
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
        context.Request.Headers.Remove("X-Forwarded-Host");
        context.Request.Headers["Sec-Fetch-Site"] = "cross-site";
        Assert.False(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
    }

    [Fact]
    public void AllowsOriginlessSameOriginReads()
    {
        var context = CreateContext("GET");
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        Assert.True(ProxyDevelopmentAccessPolicy.IsAllowed(context, Secret, 5080, true));
    }

    [Fact]
    public void ProxyModeRequiresExplicitDevelopmentConfiguration()
    {
        var settings = new Dictionary<string, string?>
        {
            ["Simulator:ProxyDevelopment:Enabled"] = "true",
            ["Simulator:ProxyDevelopment:Secret"] = new string('a', 64)
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.Throws<InvalidOperationException>(() => new SimulatorAccessPolicy(true, false, configuration));

        settings["Simulator:ProxyDevelopment:Secret"] = "invalid";
        configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.Throws<InvalidOperationException>(() => new SimulatorAccessPolicy(true, true, configuration));
    }

    [Fact]
    public void ProxyModeDoesNotAllowDirectLoopbackPolicyBypass()
    {
        var secret = new string('a', 64);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Simulator:ProxyDevelopment:Enabled"] = "true",
            ["Simulator:ProxyDevelopment:Secret"] = secret
        }).Build();
        var policy = new SimulatorAccessPolicy(true, true, configuration);
        var context = CreateContext("POST");
        context.Request.Headers.Origin = "http://localhost:5080";

        Assert.False(policy.CanMutate(context));
        context.Request.Headers[ProxyDevelopmentAccessPolicy.SecretHeader] = secret;
        Assert.True(policy.CanMutate(context));
    }

    private static DefaultHttpContext CreateContext(string method)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost", 5080);
        context.Request.Headers[ProxyDevelopmentAccessPolicy.SecretHeader] = Secret;
        return context;
    }
}

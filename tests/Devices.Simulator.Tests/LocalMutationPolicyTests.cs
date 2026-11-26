using System.Net;
using Microsoft.AspNetCore.Http;

public class LocalMutationPolicyTests
{
    [Fact]
    public void RejectsMutationsWhenDisabledEvenForSameOriginLocalRequests()
    {
        var context = CreateContext();
        context.Request.Headers.Origin = "http://localhost:5080";
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: false));
    }

    [Fact]
    public void AllowsSameOriginBrowserAndOriginlessLocalClient()
    {
        var context = CreateContext();
        context.Request.Headers.Origin = "http://localhost:5080";
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        Assert.True(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
        context.Request.Headers.Remove("Origin");
        context.Request.Headers.Remove("Sec-Fetch-Site");
        Assert.True(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void CapabilityGetAndSameOriginMutationUseTheSameDeploymentPolicy(bool allowMutations)
    {
        var context = CreateContext();
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        context.Request.Method = "GET";
        var capability = LocalMutationPolicy.IsAllowed(context.Request, allowMutations);
        context.Request.Method = "POST";
        context.Request.Headers.Origin = "http://localhost:5080";
        Assert.Equal(allowMutations, capability);
        Assert.Equal(capability, LocalMutationPolicy.IsAllowed(context.Request, allowMutations));
    }

    [Theory]
    [InlineData("http://attacker.example")]
    [InlineData("http://localhost:5081")]
    [InlineData("null")]
    [InlineData("https://localhost:5080")]
    public void RejectsCrossOriginOrMalformedOrigin(string origin)
    {
        var context = CreateContext();
        context.Request.Headers.Origin = origin;
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
    }

    [Fact]
    public void RejectsDnsRebindingForwardingAndCrossSiteMetadata()
    {
        var context = CreateContext();
        context.Request.Host = new HostString("attacker.example", 5080);
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
        context.Request.Host = new HostString("localhost", 5080);
        context.Request.Headers["X-Forwarded-Host"] = "localhost";
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
        context.Request.Headers.Remove("X-Forwarded-Host");
        context.Request.Headers["Sec-Fetch-Site"] = "cross-site";
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
    }

    [Fact]
    public void RejectsNonLoopbackOrUnknownPeersEvenWithLocalHostHeader()
    {
        var context = CreateContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.1");
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
        context.Connection.RemoteIpAddress = IPAddress.Loopback;
        context.Connection.LocalIpAddress = IPAddress.Parse("192.0.2.2");
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
        context.Connection.LocalIpAddress = null;
        Assert.False(LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));
    }

    private static DefaultHttpContext CreateContext()
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Loopback;
        context.Connection.LocalIpAddress = IPAddress.Loopback;
        context.Request.Method = "POST";
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost", 5080);
        return context;
    }
}

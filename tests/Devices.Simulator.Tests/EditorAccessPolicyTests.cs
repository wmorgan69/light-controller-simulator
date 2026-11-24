using System.Net;
using Microsoft.AspNetCore.Http;

public class EditorAccessPolicyTests
{
    [Fact]
    public void AllowsSameOriginLoopbackDevelopmentMutation()
    {
        var context = CreateContext("POST");
        context.Request.Headers.Origin = "http://localhost:5080";

        Assert.True(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
    }

    [Fact]
    public void RejectsNonLoopbackBindingsAndForwardedRequests()
    {
        var context = CreateContext("GET");
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://0.0.0.0:5080"], true));
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080", "http://0.0.0.0:5080"], true));
        Assert.False(EditorAccessPolicy.IsAllowed(context, [], true));
        context.Request.Headers["X-Forwarded-For"] = "127.0.0.1";
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
    }

    [Fact]
    public void RejectsRemoteAndNonDevelopmentRequests()
    {
        var context = CreateContext("GET");
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], false));
        context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.1");
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
    }

    [Theory]
    [InlineData("http://attacker.example:5080")]
    [InlineData("http://localhost:5081")]
    [InlineData("null")]
    public void RejectsCrossOriginAndMissingMutationOrigins(string origin)
    {
        var context = CreateContext("POST");
        context.Request.Headers.Origin = origin;
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
        context.Request.Headers.Remove("Origin");
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
    }

    [Fact]
    public void RejectsUntrustedHostEvenFromLoopback()
    {
        var context = CreateContext("GET");
        context.Request.Host = new HostString("attacker.example", 5080);
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
    }

    [Fact]
    public void RejectsHostPortThatIsNotListening()
    {
        var context = CreateContext("GET");
        context.Request.Host = new HostString("localhost", 5081);
        Assert.False(EditorAccessPolicy.IsAllowed(context, ["http://localhost:5080"], true));
    }

    private static DefaultHttpContext CreateContext(string method)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Loopback;
        context.Connection.LocalIpAddress = IPAddress.Loopback;
        context.Request.Method = method;
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost", 5080);
        return context;
    }
}

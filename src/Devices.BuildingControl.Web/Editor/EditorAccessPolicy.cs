using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

public static class EditorAccessPolicy
{
    public static bool IsAllowed(HttpContext context, IEnumerable<string> serverAddresses, bool isDevelopment)
    {
        if (!isDevelopment ||
            context.Connection.RemoteIpAddress is not { } remoteAddress ||
            context.Connection.LocalIpAddress is not { } localAddress ||
            !IPAddress.IsLoopback(remoteAddress) ||
            !IPAddress.IsLoopback(localAddress) ||
            context.Request.Headers.Keys.Any(IsForwardingHeader))
            return false;

        var addresses = serverAddresses.ToArray();
        if (addresses.Length == 0 || addresses.Any(address =>
            !Uri.TryCreate(address, UriKind.Absolute, out var uri) || !IsLoopbackHost(uri.Host)))
            return false;

        if (!Uri.TryCreate($"{context.Request.Scheme}://{context.Request.Host}", UriKind.Absolute, out var requestOrigin) ||
            !IsLoopbackHost(requestOrigin.Host) ||
            requestOrigin.UserInfo.Length != 0 ||
            requestOrigin.AbsolutePath != "/" ||
            requestOrigin.Query.Length != 0 ||
            requestOrigin.Fragment.Length != 0 ||
            !addresses.Any(address =>
            {
                var serverAddress = new Uri(address);
                return serverAddress.Port == requestOrigin.Port &&
                    string.Equals(serverAddress.Scheme, requestOrigin.Scheme, StringComparison.OrdinalIgnoreCase);
            }))
            return false;

        StringValues origins = context.Request.Headers.Origin;
        if (origins.Count == 0)
            return HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method);
        if (origins.Count != 1 || !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin))
            return false;

        return origin.UserInfo.Length == 0 &&
            origin.AbsolutePath == "/" &&
            origin.Query.Length == 0 &&
            origin.Fragment.Length == 0 &&
            string.Equals(origin.Scheme, requestOrigin.Scheme, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(origin.Host, requestOrigin.Host, StringComparison.OrdinalIgnoreCase) &&
            origin.Port == requestOrigin.Port;
    }

    private static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        (IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address));

    private static bool IsForwardingHeader(string header) =>
        header.Equals("Forwarded", StringComparison.OrdinalIgnoreCase) ||
        header.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase) ||
        header.Equals("X-Real-IP", StringComparison.OrdinalIgnoreCase) ||
        header.Equals("X-Original-Host", StringComparison.OrdinalIgnoreCase);
}

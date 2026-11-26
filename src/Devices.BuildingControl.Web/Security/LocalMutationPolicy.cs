using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

public static class LocalMutationPolicy
{
    public static bool IsAllowed(HttpRequest request, bool allowMutations)
    {
        if (!allowMutations ||
            request.HttpContext.Connection.RemoteIpAddress is not { } remoteAddress ||
            request.HttpContext.Connection.LocalIpAddress is not { } localAddress ||
            !IPAddress.IsLoopback(remoteAddress) ||
            !IPAddress.IsLoopback(localAddress))
            return false;
        if (request.Headers.Keys.Any(header =>
            header.Equals("Forwarded", StringComparison.OrdinalIgnoreCase) ||
            header.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase) ||
            header.Equals("X-Real-IP", StringComparison.OrdinalIgnoreCase) ||
            header.Equals("X-Original-Host", StringComparison.OrdinalIgnoreCase)))
            return false;

        if (!Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out var requestOrigin) ||
            !(string.Equals(requestOrigin.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
              (IPAddress.TryParse(requestOrigin.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address))) ||
            requestOrigin.UserInfo.Length != 0 || requestOrigin.AbsolutePath != "/" ||
            requestOrigin.Query.Length != 0 || requestOrigin.Fragment.Length != 0)
            return false;

        StringValues fetchSite = request.Headers["Sec-Fetch-Site"];
        if (fetchSite.Count > 0 &&
            (fetchSite.Count != 1 || !string.Equals(fetchSite[0], "same-origin", StringComparison.OrdinalIgnoreCase)))
            return false;

        StringValues origins = request.Headers.Origin;
        if (origins.Count == 0) return true;
        if (origins.Count != 1 || !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin))
            return false;

        return origin.UserInfo.Length == 0 && origin.AbsolutePath == "/" &&
            origin.Query.Length == 0 && origin.Fragment.Length == 0 &&
            string.Equals(origin.Scheme, requestOrigin.Scheme, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(origin.Host, requestOrigin.Host, StringComparison.OrdinalIgnoreCase) &&
            origin.Port == requestOrigin.Port;
    }
}

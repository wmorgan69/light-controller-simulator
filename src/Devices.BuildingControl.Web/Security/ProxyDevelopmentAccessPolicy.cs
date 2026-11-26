using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

public static class ProxyDevelopmentAccessPolicy
{
    public const string SecretHeader = "X-Development-Proxy-Secret";

    public static bool IsAllowed(HttpContext context, string? secret, int port, bool isDevelopment)
    {
        if (!isDevelopment || string.IsNullOrEmpty(secret) || port is < 1 or > 65535)
            return false;

        var request = context.Request;
        StringValues supplied = request.Headers[SecretHeader];
        if (supplied.Count != 1 || supplied[0] is not { } suppliedSecret ||
            !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(suppliedSecret), Encoding.UTF8.GetBytes(secret)))
            return false;

        if (request.Headers.Keys.Any(IsForwardingHeader) ||
            !string.Equals(request.Scheme, "http", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(request.Host.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            request.Host.Port != port)
            return false;

        var isRead = HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method);
        StringValues fetchSite = request.Headers["Sec-Fetch-Site"];
        if (fetchSite.Count > 0 &&
            (fetchSite.Count != 1 ||
             !(string.Equals(fetchSite[0], "same-origin", StringComparison.OrdinalIgnoreCase) ||
               (isRead && string.Equals(fetchSite[0], "none", StringComparison.OrdinalIgnoreCase)))))
            return false;

        StringValues origins = request.Headers.Origin;
        if (origins.Count == 0) return isRead;
        if (origins.Count != 1 || !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin))
            return false;

        return origin.UserInfo.Length == 0 && origin.AbsolutePath == "/" &&
            origin.Query.Length == 0 && origin.Fragment.Length == 0 &&
            string.Equals(origin.Scheme, "http", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(origin.Host, "localhost", StringComparison.OrdinalIgnoreCase) &&
            origin.Port == port;
    }

    private static bool IsForwardingHeader(string header) =>
        header.Equals("Forwarded", StringComparison.OrdinalIgnoreCase) ||
        header.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase) ||
        header.Equals("X-Real-IP", StringComparison.OrdinalIgnoreCase) ||
        header.Equals("X-Original-Host", StringComparison.OrdinalIgnoreCase);
}

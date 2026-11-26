using Microsoft.AspNetCore.Http;

public sealed class SimulatorAccessPolicy
{
    private readonly bool allowMutations;
    private readonly bool isDevelopment;
    private readonly bool proxyEnabled;
    private readonly string? proxySecret;
    private readonly int proxyPort;

    public SimulatorAccessPolicy(bool allowMutations, bool isDevelopment, IConfiguration configuration)
    {
        this.allowMutations = allowMutations;
        this.isDevelopment = isDevelopment;
        proxyEnabled = configuration.GetValue("Simulator:ProxyDevelopment:Enabled", false);
        proxySecret = configuration["Simulator:ProxyDevelopment:Secret"];
        proxyPort = configuration.GetValue("Simulator:ProxyDevelopment:PublicPort", 5080);

        if (proxyEnabled && (!isDevelopment || proxyPort is < 1 or > 65535 ||
            proxySecret is not { Length: 64 } ||
            proxySecret.Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f'))))
            throw new InvalidOperationException("The development proxy requires Development, a valid port, and a 64-character lowercase hexadecimal secret.");
    }

    public bool CanMutate(HttpContext context) => allowMutations && (proxyEnabled
        ? ProxyDevelopmentAccessPolicy.IsAllowed(context, proxySecret, proxyPort, isDevelopment)
        : LocalMutationPolicy.IsAllowed(context.Request, allowMutations: true));

    public bool CanEdit(HttpContext context, IEnumerable<string> serverAddresses) => proxyEnabled
        ? ProxyDevelopmentAccessPolicy.IsAllowed(context, proxySecret, proxyPort, isDevelopment)
        : EditorAccessPolicy.IsAllowed(context, serverAddresses, isDevelopment);
}

using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

public static class SimulatorCapabilities
{
    public static void Map(WebApplication app, bool allowHttpMutations)
    {
        app.MapGet("/api/capabilities", (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var addresses = context.RequestServices.GetRequiredService<IServer>().Features
                .Get<IServerAddressesFeature>()?.Addresses ?? [];
            var mutationsAllowed = LocalMutationPolicy.IsAllowed(context.Request, allowHttpMutations);
            return Results.Ok(new
            {
                mutationsAllowed,
                editorAllowed = mutationsAllowed &&
                    EditorAccessPolicy.IsAllowed(context, addresses, app.Environment.IsDevelopment())
            });
        });
    }
}

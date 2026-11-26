using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

public static class SimulatorCapabilities
{
    public static void Map(WebApplication app, bool allowHttpMutations, SimulatorAccessPolicy? access = null)
    {
        access ??= new SimulatorAccessPolicy(allowHttpMutations, app.Environment.IsDevelopment(), app.Configuration);
        app.MapGet("/api/capabilities", (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var addresses = context.RequestServices.GetRequiredService<IServer>().Features
                .Get<IServerAddressesFeature>()?.Addresses ?? [];
            var mutationsAllowed = access.CanMutate(context);
            return Results.Ok(new
            {
                mutationsAllowed,
                editorAllowed = mutationsAllowed &&
                    access.CanEdit(context, addresses)
            });
        });
    }
}

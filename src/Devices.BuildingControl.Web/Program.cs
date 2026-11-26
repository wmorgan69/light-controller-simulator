using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSingleton<BuildingSimulator>();
builder.Services.AddSingleton<ISimulatedDeviceConnector>(provider => provider.GetRequiredService<BuildingSimulator>());
builder.Services.AddSingleton<IBuildingDeviceConnector>(provider => provider.GetRequiredService<ISimulatedDeviceConnector>());
builder.Services.AddSingleton(provider =>
{
    var configuration = provider.GetRequiredService<IConfiguration>();
    var connectionString = configuration.GetConnectionString("Control");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("ConnectionStrings:Control must be configured for Building Control.");
    return new BuildingDesignStore(connectionString);
});
builder.Services.AddSingleton(provider =>
{
    var configuration = provider.GetRequiredService<IConfiguration>();
    var connectionString = configuration.GetConnectionString("Control");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("ConnectionStrings:Control must be configured for Building Control.");
    return new BuildingControlOwnerLease(connectionString,
        provider.GetRequiredService<IHostApplicationLifetime>(),
        provider.GetRequiredService<ILogger<BuildingControlOwnerLease>>());
});
builder.Services.AddHostedService(provider => provider.GetRequiredService<BuildingControlOwnerLease>());
builder.Services.AddHostedService<BuildingEditorStartupService>();
builder.Services.AddSingleton<MqttTelemetryPublisher>();
builder.Services.AddSingleton<BuildingEditorService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<MqttTelemetryPublisher>());

var app = builder.Build();
var allowHttpMutations = builder.Configuration.GetValue<bool?>("Simulator:AllowHttpMutations") ?? true;
var access = new SimulatorAccessPolicy(allowHttpMutations, app.Environment.IsDevelopment(), builder.Configuration);
app.UseWhen(context => context.Request.Path.StartsWithSegments("/api/building-editor"), branch =>
    branch.Use(async (context, next) =>
    {
        var addresses = context.RequestServices.GetRequiredService<IServer>().Features
            .Get<IServerAddressesFeature>()?.Addresses ?? [];
        if (!access.CanEdit(context, addresses))
        {
            await Results.Problem(statusCode: StatusCodes.Status403Forbidden,
                detail: "The building editor requires an authorized local development connection.")
                .ExecuteAsync(context);
            return;
        }
        await next(context);
    }));
app.UseWhen(context => context.Request.Path.StartsWithSegments("/api") &&
    !(HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method) ||
      HttpMethods.IsOptions(context.Request.Method)), branch =>
    branch.Use(async (context, next) =>
    {
        if (!access.CanMutate(context))
        {
            await Results.Problem(statusCode: StatusCodes.Status403Forbidden,
                detail: allowHttpMutations
                    ? "Simulator mutations require an authorized local same-origin request."
                    : "Simulator HTTP mutations are disabled for this deployment.")
                .ExecuteAsync(context);
            return;
        }
        await next(context);
    }));
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/controllers", (IBuildingDeviceConnector simulator) => Results.Ok(simulator.GetControllers()));
app.MapGet("/api/controller-snapshot", (IBuildingDeviceConnector simulator) => Results.Ok(simulator.GetControllerSnapshot()));
app.MapGet("/api/building-view", (IBuildingDeviceConnector simulator) => Results.Ok(simulator.GetBuildingView()));
app.MapGet("/api/building-design-status", (BuildingEditorService editor) => Results.Ok(editor.ReadStatus()));
SimulatorCapabilities.Map(app, allowHttpMutations, access);
app.MapGet("/api/building-editor", (BuildingEditorService editor) => Results.Ok(editor.Read()));
app.MapGet("/api/building-editor/default-design", () => Results.Ok(BuildingDesignSeed.Create()));
app.MapPost("/api/building-editor/save", (BuildingEditorWriteRequest request, BuildingEditorService editor) => editor.Save(request));
app.MapPost("/api/building-editor/retry", (BuildingEditorService editor) => editor.Retry());
app.MapPost("/api/building-editor/retry-cleanup", (BuildingEditorService editor) => editor.RetryCleanup());
app.MapGet("/api/controllers/{controllerId}", (string controllerId, IBuildingDeviceConnector simulator) =>
    simulator.GetController(controllerId) is { } controller ? Results.Ok(controller) : Results.NotFound());
app.MapGet("/api/status", (MqttTelemetryPublisher mqtt) => Results.Ok(mqtt.Status));

app.MapPost("/api/rooms/{roomId}/sensor/trigger", async (string roomId, ISimulatedDeviceConnector simulator, MqttTelemetryPublisher mqtt) =>
{
    var result = simulator.TriggerSensor(roomId, out var controller);
    if (result == SensorTriggerResult.RoomNotFound) return Results.NotFound();
    if (result == SensorTriggerResult.SensorFaulted) return Results.Conflict("The room sensor has an active fault.");
    _ = mqtt.PublishAsync(controller!);
    return Results.Ok(controller);
});

app.MapPost("/api/rooms/{roomId}/sensor/reset", async (string roomId, ISimulatedDeviceConnector simulator, MqttTelemetryPublisher mqtt) =>
{
    if (!simulator.ResetSensor(roomId, out var controller)) return Results.NotFound();
    _ = mqtt.PublishAsync(controller);
    return Results.Ok(controller);
});

app.MapPost("/api/devices/{deviceId}/faults", async (string deviceId, FaultRequest request, ISimulatedDeviceConnector simulator, MqttTelemetryPublisher mqtt) =>
{
    var result = simulator.AddFault(deviceId, request, out var controller);
    if (result == FaultMutationResult.ControllerNotFound) return Results.NotFound();
    if (result == FaultMutationResult.InvalidTarget) return Results.BadRequest("The fault scope or target is invalid for this controller.");
    if (result == FaultMutationResult.Duplicate) return Results.Conflict("A fault already exists for this target.");
    _ = mqtt.PublishAsync(controller!);
    return Results.Ok(controller);
});

app.MapDelete("/api/devices/{deviceId}/faults/{faultId}", async (string deviceId, string faultId, ISimulatedDeviceConnector simulator, MqttTelemetryPublisher mqtt) =>
{
    if (!simulator.ClearFault(deviceId, faultId, out var controller)) return Results.NotFound();
    _ = mqtt.PublishAsync(controller);
    return Results.Ok(controller);
});
app.MapPost("/api/scenarios/reset", (ISimulatedDeviceConnector simulator, MqttTelemetryPublisher mqtt) =>
{
    var controllers = simulator.ResetBuilding();
    foreach (var controller in controllers)
        _ = mqtt.PublishAsync(controller);
    return Results.Ok(controllers);
});
app.MapPost("/api/scenarios/occupancy", (ISimulatedDeviceConnector simulator, MqttTelemetryPublisher mqtt) =>
{
    var controllers = simulator.SetRandomOccupancy();
    foreach (var controller in controllers)
        _ = mqtt.PublishAsync(controller);
    return Results.Ok(controllers);
});

app.Run();

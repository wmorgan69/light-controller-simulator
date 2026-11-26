using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSingleton<TelemetryStore>();
builder.Services.AddSingleton<TelemetrySubscriber>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<TelemetrySubscriber>());

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/telemetry", (TelemetryStore store) => Results.Ok(store.GetSnapshot()));
app.MapGet("/api/telemetry/{controllerId}", (string controllerId, TelemetryStore store) =>
    store.GetController(controllerId) is { } state ? Results.Ok(state) : Results.NotFound());
app.MapGet("/api/events", (TelemetryStore store) => Results.Ok(store.GetEvents()));
app.MapGet("/api/status", (TelemetrySubscriber subscriber) => Results.Ok(subscriber.Status));

app.Run();

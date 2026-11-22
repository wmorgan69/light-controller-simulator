using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Devices.Contracts;
using MQTTnet;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSingleton<BuildingSimulator>();
builder.Services.AddSingleton<MqttTelemetryPublisher>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<MqttTelemetryPublisher>());

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/controllers", (BuildingSimulator simulator) => Results.Ok(simulator.GetControllers()));
app.MapGet("/api/controllers/{controllerId}", (string controllerId, BuildingSimulator simulator) =>
    simulator.GetController(controllerId) is { } controller ? Results.Ok(controller) : Results.NotFound());
app.MapGet("/api/status", (MqttTelemetryPublisher mqtt) => Results.Ok(mqtt.Status));

app.MapPost("/api/rooms/{roomId}/sensor/trigger", async (string roomId, BuildingSimulator simulator, MqttTelemetryPublisher mqtt) =>
{
    var result = simulator.TriggerSensor(roomId, out var controller);
    if (result == SensorTriggerResult.RoomNotFound) return Results.NotFound();
    if (result == SensorTriggerResult.SensorFaulted) return Results.Conflict("The room sensor has an active fault.");
    _ = mqtt.PublishAsync(controller!);
    return Results.Ok(controller);
});

app.MapPost("/api/rooms/{roomId}/sensor/reset", async (string roomId, BuildingSimulator simulator, MqttTelemetryPublisher mqtt) =>
{
    if (!simulator.ResetSensor(roomId, out var controller)) return Results.NotFound();
    _ = mqtt.PublishAsync(controller);
    return Results.Ok(controller);
});

app.MapPost("/api/devices/{deviceId}/faults", async (string deviceId, FaultRequest request, BuildingSimulator simulator, MqttTelemetryPublisher mqtt) =>
{
    var result = simulator.AddFault(deviceId, request, out var controller);
    if (result == FaultMutationResult.ControllerNotFound) return Results.NotFound();
    if (result == FaultMutationResult.InvalidTarget) return Results.BadRequest("The fault scope or target is invalid for this controller.");
    if (result == FaultMutationResult.Duplicate) return Results.Conflict("A fault already exists for this target.");
    _ = mqtt.PublishAsync(controller!);
    return Results.Ok(controller);
});

app.MapDelete("/api/devices/{deviceId}/faults/{faultId}", async (string deviceId, string faultId, BuildingSimulator simulator, MqttTelemetryPublisher mqtt) =>
{
    if (!simulator.ClearFault(deviceId, faultId, out var controller)) return Results.NotFound();
    _ = mqtt.PublishAsync(controller);
    return Results.Ok(controller);
});
app.MapPost("/api/scenarios/reset", (BuildingSimulator simulator, MqttTelemetryPublisher mqtt) =>
{
    var controllers = simulator.ResetBuilding();
    foreach (var controller in controllers)
        _ = mqtt.PublishAsync(controller);
    return Results.Ok(controllers);
});
app.MapPost("/api/scenarios/occupancy", (BuildingSimulator simulator, MqttTelemetryPublisher mqtt) =>
{
    var controllers = simulator.SetRandomOccupancy();
    foreach (var controller in controllers)
        _ = mqtt.PublishAsync(controller);
    return Results.Ok(controllers);
});

app.Run();

public sealed record FaultRequest(string Scope, string TargetId, string Description);

public enum SensorTriggerResult
{
    Triggered,
    RoomNotFound,
    SensorFaulted
}

public enum FaultMutationResult
{
    Added,
    ControllerNotFound,
    InvalidTarget,
    Duplicate
}

public sealed class BuildingSimulator
{
    private readonly object gate = new();
    private readonly ConcurrentDictionary<string, ControllerState> controllers = new(
        DeviceIds.CreateBuilding().ToDictionary(controller => controller.Id));

    public IReadOnlyList<ControllerState> GetControllers()
    {
        lock (gate)
            return controllers.Values.OrderBy(controller => controller.Floor).ToArray();
    }

    public ControllerState? GetController(string controllerId)
    {
        lock (gate)
            return controllers.TryGetValue(controllerId, out var controller) ? controller : null;
    }

    public SensorTriggerResult TriggerSensor(string roomId, out ControllerState? controller)
    {
        lock (gate)
        {
            controller = null;
            foreach (var existing in controllers.Values)
            {
                var room = existing.Rooms.FirstOrDefault(candidate => candidate.Id == roomId);
                if (room is null) continue;
                if (existing.Faults.Any(fault => fault.Scope == "sensor" && fault.TargetId == SensorId(room, existing.Floor)))
                {
                    controller = existing;
                    return SensorTriggerResult.SensorFaulted;
                }

                var triggered = new RoomState(room.Id, room.Name, room.ControllerId, true, true,
                    room.LightStrips.Select(strip => new LightStrip(strip.Id, strip.RoomId, !strip.IsFaulted, strip.IsFaulted)).ToArray());
                var rooms = existing.Rooms.Select(candidate => candidate.Id == roomId ? triggered : candidate).ToArray();
                controller = existing with
                {
                    Status = existing.Faults.Count == 0 ? ControllerStatus.Healthy : ControllerStatus.Faulted,
                    LastSeen = DateTimeOffset.UtcNow,
                    Rooms = rooms,
                    Revision = existing.Revision + 1
                };
                controllers[existing.Id] = controller;
                return SensorTriggerResult.Triggered;
            }
            return SensorTriggerResult.RoomNotFound;
        }
    }

    public bool ResetSensor(string roomId, out ControllerState controller)
    {
        lock (gate)
        {
            controller = null!;
            foreach (var existing in controllers.Values)
            {
                var room = existing.Rooms.FirstOrDefault(candidate => candidate.Id == roomId);
                if (room is null) continue;

                var reset = room with
                {
                    Presence = false,
                    SensorTriggered = false,
                    LightStrips = room.LightStrips
                        .Select(strip => strip with { IsOn = false })
                        .ToArray()
                };
                var rooms = existing.Rooms.Select(candidate => candidate.Id == roomId ? reset : candidate).ToArray();
                controller = existing with
                {
                    LastSeen = DateTimeOffset.UtcNow,
                    Rooms = rooms,
                    Revision = existing.Revision + 1
                };
                controllers[existing.Id] = controller;
                return true;
            }
            return false;
        }
    }

    public FaultMutationResult AddFault(string deviceId, FaultRequest request, out ControllerState? controller)
    {
        lock (gate)
        {
            if (!TryFindController(deviceId, out var existing))
            {
                controller = null;
                return FaultMutationResult.ControllerNotFound;
            }
            if (!IsValidFaultTarget(existing, request))
            {
                controller = existing;
                return FaultMutationResult.InvalidTarget;
            }
            if (existing.Faults.Any(fault => fault.Scope == request.Scope && fault.TargetId == request.TargetId))
            {
                controller = existing;
                return FaultMutationResult.Duplicate;
            }

            var fault = new ControllerFault($"fault-{Guid.NewGuid():N}", request.Scope, request.TargetId, request.Description);
            var faults = existing.Faults.Append(fault).ToArray();
            var rooms = existing.Rooms.Select(room => ApplyRoomFault(room, fault, existing.Floor)).ToArray();
            controller = existing with
            {
                Status = ControllerStatus.Faulted,
                LastSeen = DateTimeOffset.UtcNow,
                Rooms = rooms,
                Faults = faults,
                Revision = existing.Revision + 1
            };
            controllers[existing.Id] = controller;
            return FaultMutationResult.Added;
        }
    }

    public bool ClearFault(string deviceId, string faultId, out ControllerState controller)
    {
        lock (gate)
        {
            if (!TryFindController(deviceId, out var existing))
            {
                controller = null!;
                return false;
            }

            var fault = existing.Faults.FirstOrDefault(candidate => candidate.Id == faultId);
            if (fault is null)
            {
                controller = existing;
                return false;
            }

            var faults = existing.Faults.Where(candidate => candidate.Id != faultId).ToArray();
            var rooms = existing.Rooms.Select(room => RestoreRoomFault(room, fault, existing.Floor)).ToArray();
            controller = existing with
            {
                Status = faults.Length == 0 ? ControllerStatus.Healthy : ControllerStatus.Faulted,
                LastSeen = DateTimeOffset.UtcNow,
                Rooms = rooms,
                Faults = faults,
                Revision = existing.Revision + 1
            };
            controllers[existing.Id] = controller;
            return true;
        }
    }

    public bool ClearFaultByTarget(string controllerId, string targetId, out ControllerState controller)
    {
        lock (gate)
        {
            if (!controllers.TryGetValue(controllerId, out var existing))
            {
                controller = null!;
                return false;
            }
            var fault = existing.Faults.FirstOrDefault(candidate =>
                candidate.TargetId == targetId || candidate.Id == targetId);
            if (fault is null)
            {
                controller = existing;
                return false;
            }
            return ClearFault(controllerId, fault.Id, out controller);
        }
    }

    public bool IsRoomOwnedBy(string controllerId, string roomId)
    {
        lock (gate)
        {
            return controllers.TryGetValue(controllerId, out var controller) &&
                controller.Rooms.Any(room => room.Id == roomId);
        }
    }

    public bool IsFaultTargetOwnedBy(string controllerId, FaultRequest request)
    {
        lock (gate)
        {
            return controllers.TryGetValue(controllerId, out var controller) &&
                IsValidFaultTarget(controller, request);
        }
    }

    public IReadOnlyList<ControllerState> ResetBuilding()
    {
        lock (gate)
        {
            var resetControllers = controllers.Values
                .Select(existing =>
                {
                    var rooms = existing.Rooms.Select(room => room with
                    {
                        Presence = false,
                        SensorTriggered = false,
                        LightStrips = room.LightStrips
                            .Select(strip => strip with { IsOn = false, IsFaulted = false })
                            .ToArray()
                    }).ToArray();
                    var reset = existing with
                    {
                        Status = ControllerStatus.Healthy,
                        LastSeen = DateTimeOffset.UtcNow,
                        Rooms = rooms,
                        Faults = Array.Empty<ControllerFault>(),
                        Revision = existing.Revision + 1
                    };
                    controllers[existing.Id] = reset;
                    return reset;
                })
                .OrderBy(controller => controller.Floor)
                .ToArray();
            return resetControllers;
        }
    }

    public IReadOnlyList<ControllerState> SetRandomOccupancy() =>
        SetRandomOccupancy(Random.Shared);

    public IReadOnlyList<ControllerState> SetRandomOccupancy(Random random)
    {
        lock (gate)
        {
            var occupiedControllers = controllers.Values
                .Select(existing =>
                {
                    var roomIndices = Enumerable.Range(0, existing.Rooms.Count).ToArray();
                    for (var index = roomIndices.Length - 1; index > 0; index--)
                    {
                        var swapIndex = random.Next(index + 1);
                        (roomIndices[index], roomIndices[swapIndex]) =
                            (roomIndices[swapIndex], roomIndices[index]);
                    }

                    var occupiedCount = random.Next(1, 3);
                    var occupiedIds = roomIndices.Take(occupiedCount)
                        .Select(index => existing.Rooms[index].Id)
                        .ToHashSet(StringComparer.Ordinal);

                    var rooms = existing.Rooms.Select(room =>
                    {
                        var occupied = occupiedIds.Contains(room.Id);
                        return room with
                        {
                            Presence = occupied,
                            SensorTriggered = occupied,
                            LightStrips = room.LightStrips
                                .Select(strip => strip with
                                {
                                    IsOn = occupied,
                                    IsFaulted = false
                                })
                                .ToArray()
                        };
                    }).ToArray();
                    var occupiedController = existing with
                    {
                        Status = ControllerStatus.Healthy,
                        LastSeen = DateTimeOffset.UtcNow,
                        Rooms = rooms,
                        Faults = Array.Empty<ControllerFault>(),
                        Revision = existing.Revision + 1
                    };
                    controllers[existing.Id] = occupiedController;
                    return occupiedController;
                })
                .OrderBy(controller => controller.Floor)
                .ToArray();
            return occupiedControllers;
        }
    }

    private bool TryFindController(string deviceId, out ControllerState controller)
    {
        controller = null!;
        if (controllers.TryGetValue(deviceId, out var found))
        {
            controller = found;
            return true;
        }
        foreach (var candidate in controllers.Values)
        {
            if (candidate.Rooms.Any(room => room.Id == deviceId || room.LightStrips.Any(strip => strip.Id == deviceId)))
            {
                controller = candidate;
                return true;
            }
        }
        return false;
    }

    private static RoomState ApplyRoomFault(RoomState room, ControllerFault fault, int floor)
    {
        if (fault.Scope == "sensor" && fault.TargetId == SensorId(room, floor))
            return room with { Presence = false, SensorTriggered = false };
        if (fault.Scope == "light" && room.LightStrips.Any(strip => strip.Id == fault.TargetId))
        {
            var strips = room.LightStrips.Select(strip => strip.Id == fault.TargetId
                ? strip with { IsFaulted = true, IsOn = false }
                : strip).ToArray();
            return room with { LightStrips = strips };
        }
        return room;
    }

    private static RoomState RestoreRoomFault(RoomState room, ControllerFault fault, int floor)
    {
        if (fault.Scope == "sensor" && fault.TargetId == SensorId(room, floor))
            return room;
        if (fault.Scope == "light" && room.LightStrips.Any(strip => strip.Id == fault.TargetId))
        {
            var strips = room.LightStrips.Select(strip => strip.Id == fault.TargetId
                ? strip with { IsFaulted = false, IsOn = room.SensorTriggered }
                : strip).ToArray();
            return room with { LightStrips = strips };
        }
        return room;
    }

    private static string SensorId(RoomState room, int floor) =>
        $"sensor-floor-{floor}-{room.Id[($"floor-{floor}-").Length..]}";

    private static bool IsValidFaultTarget(ControllerState controller, FaultRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Description) || string.IsNullOrWhiteSpace(request.TargetId)) return false;
        return request.Scope switch
        {
            "sensor" => controller.Rooms.Any(room => SensorId(room, controller.Floor) == request.TargetId),
            "light" => controller.Rooms.SelectMany(room => room.LightStrips).Any(strip => strip.Id == request.TargetId),
            "controller" => controller.Id == request.TargetId,
            _ => false
        };
    }
}

public sealed class MqttTelemetryPublisher : IHostedService
{
    private readonly ILogger<MqttTelemetryPublisher> logger;
    private readonly IConfiguration configuration;
    private readonly BuildingSimulator simulator;
    private IMqttClient? client;
    private Channel<ControllerState>? outbound;
    private CancellationTokenSource? publisherCts;
    private Task? publisherTask;
    private readonly object statusGate = new();
    private bool mqttConnected;
    private DateTimeOffset? lastMqttConnectedAt;

    public MqttTelemetryPublisher(ILogger<MqttTelemetryPublisher> logger, IConfiguration configuration, BuildingSimulator simulator)
    {
        this.logger = logger;
        this.configuration = configuration;
        this.simulator = simulator;
    }

    public DeviceTransportStatus Status
    {
        get
        {
            lock (statusGate)
            {
                return new DeviceTransportStatus(
                    mqttConnected,
                    true,
                    lastMqttConnectedAt,
                    mqttConnected ? "MQTT connected" : "MQTT unavailable; HTTP control remains available");
            }
        }
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        outbound = Channel.CreateBounded<ControllerState>(new BoundedChannelOptions(128)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        publisherCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        publisherTask = RunAsync(publisherCts.Token);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        publisherCts?.Cancel();
        if (publisherTask is not null)
        {
            try { await publisherTask.WaitAsync(cancellationToken); }
            catch (OperationCanceledException) { }
        }
        if (client is not null)
        {
            foreach (var controller in simulator.GetControllers())
            {
                await PublishRetainedAsync(controller with
                {
                    Status = ControllerStatus.Offline,
                    Revision = controller.Revision + 1,
                    LastSeen = DateTimeOffset.UtcNow
                });
            }
            await client.DisconnectAsync(cancellationToken: cancellationToken);
        }
    }

    public Task PublishAsync(ControllerState state)
    {
        outbound?.Writer.TryWrite(state);
        return Task.CompletedTask;
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        try
        {
            client ??= new MqttClientFactory().CreateMqttClient();
            client.ApplicationMessageReceivedAsync += HandleCommandAsync;

            while (!cancellationToken.IsCancellationRequested)
            {
                if (client is null || !client.IsConnected)
                    await ConnectAsync(cancellationToken);

                if (client is not null && client.IsConnected)
                {
                    if (outbound is not null)
                    {
                        while (outbound.Reader.TryRead(out var state))
                        {
                            await PublishRetainedAsync(state);
                        }
                    }
                }
                await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken);
            }
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "MQTT publisher stopped unexpectedly; HTTP control remains available");
        }
    }

    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        try
        {
            client ??= new MqttClientFactory().CreateMqttClient();
            var host = configuration["Mqtt:Host"] ?? "localhost";
            var port = configuration.GetValue("Mqtt:Port", 1883);
            var options = new MqttClientOptionsBuilder()
                .WithTcpServer(host, port)
                .WithWillTopic("building/controllers/lwt")
                .WithWillPayload("offline")
                .WithWillRetain(true)
                .Build();
            await client.ConnectAsync(options, cancellationToken);
            await client.SubscribeAsync("building/controllers/+/commands");
            lock (statusGate)
            {
                mqttConnected = true;
                lastMqttConnectedAt = DateTimeOffset.UtcNow;
            }
            foreach (var controller in simulator.GetControllers())
                await PublishRetainedAsync(controller);
            logger.LogInformation("MQTT broker connected at {Host}:{Port}", host, port);
        }
        catch (Exception exception)
        {
            lock (statusGate) mqttConnected = false;
            client?.Dispose();
            client = null;
            logger.LogDebug(exception, "MQTT broker unavailable; HTTP control remains available");
        }
    }

    private async Task PublishRetainedAsync(ControllerState state)
    {
        if (client is null || !client.IsConnected) return;
        try
        {
            var telemetry = new DeviceTelemetry(Guid.NewGuid().ToString("N"), state.Id,
                state.Faults.Count == 0 ? "state.changed" : "fault.changed", DateTimeOffset.UtcNow, state);
            var json = JsonSerializer.Serialize(telemetry, new JsonSerializerOptions(JsonSerializerDefaults.Web)
            {
                Converters = { new JsonStringEnumConverter() }
            });
            var message = new MqttApplicationMessageBuilder()
                .WithTopic($"building/controllers/{state.Id}/telemetry")
                .WithPayload(Encoding.UTF8.GetBytes(json))
                .WithRetainFlag()
                .Build();
            await client.PublishAsync(message);
            lock (statusGate)
            {
                mqttConnected = true;
                lastMqttConnectedAt = DateTimeOffset.UtcNow;
            }
        }
        catch (Exception exception)
        {
            lock (statusGate) mqttConnected = false;
            logger.LogDebug(exception, "MQTT publish failed; will retry on reconnect");
        }
    }

    private async Task PublishAckAsync(string controllerId, string commandId, DeviceCommandAck ack)
    {
        if (client is null || !client.IsConnected) return;
        var ackJson = JsonSerializer.Serialize(ack, new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            Converters = { new JsonStringEnumConverter() }
        });
        var ackMessage = new MqttApplicationMessageBuilder()
            .WithTopic($"building/controllers/{controllerId}/commands/{commandId}/ack")
            .WithPayload(Encoding.UTF8.GetBytes(ackJson))
            .Build();
        await client.PublishAsync(ackMessage);
    }

    private async Task HandleCommandAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        try
        {
            var json = Encoding.UTF8.GetString(args.ApplicationMessage.Payload);
            var command = JsonSerializer.Deserialize<DeviceCommand>(json,
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
                {
                    Converters = { new JsonStringEnumConverter() }
                });
            if (command is null ||
                string.IsNullOrWhiteSpace(command.CommandId) ||
                string.IsNullOrWhiteSpace(command.ControllerId) ||
                string.IsNullOrWhiteSpace(command.Action))
                return;

            var topicParts = args.ApplicationMessage.Topic?.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var validTopic = topicParts is { Length: 4 } &&
                topicParts[0] == "building" &&
                topicParts[1] == "controllers" &&
                topicParts[3] == "commands";
            var topicControllerId = validTopic ? topicParts![2] : null;
            if (!validTopic || !string.Equals(topicControllerId, command.ControllerId, StringComparison.Ordinal))
            {
                var mismatchAck = new DeviceCommandAck(command.CommandId, command.ControllerId, false,
                    "Command topic and controller ID do not match", null, DateTimeOffset.UtcNow);
                await PublishAckAsync(command.ControllerId, command.CommandId, mismatchAck);
                return;
            }

            ControllerState? state = null;
            var accepted = false;
            var message = "Unsupported command";

            if (command.Action.Equals("trigger", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(command.RoomId))
            {
                if (!simulator.IsRoomOwnedBy(command.ControllerId, command.RoomId))
                {
                    message = "Room is not owned by the addressed controller";
                }
                else
                {
                var result = simulator.TriggerSensor(command.RoomId, out state);
                accepted = result == SensorTriggerResult.Triggered;
                message = result switch
                {
                    SensorTriggerResult.Triggered => "Sensor triggered",
                    SensorTriggerResult.SensorFaulted => "Room sensor has an active fault",
                    _ => "Room not found"
                };
                }
            }
            else if (command.Action.Equals("reset", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(command.RoomId))
            {
                if (!simulator.IsRoomOwnedBy(command.ControllerId, command.RoomId))
                {
                    message = "Room is not owned by the addressed controller";
                }
                else
                {
                    accepted = simulator.ResetSensor(command.RoomId, out state);
                    message = accepted ? "Sensor reset" : "Room not found";
                }
            }
            else if (command.Action.Equals("add-fault", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(command.Scope) &&
                !string.IsNullOrWhiteSpace(command.TargetId))
            {
                var request = new FaultRequest(
                    command.Scope,
                    command.TargetId,
                    string.IsNullOrWhiteSpace(command.Description) ? $"Simulated {command.Scope} fault" : command.Description);
                if (!simulator.IsFaultTargetOwnedBy(command.ControllerId, request))
                {
                    message = "Fault target is not owned by the addressed controller";
                }
                else
                {
                    var result = simulator.AddFault(command.ControllerId, request, out state);
                    accepted = result == FaultMutationResult.Added;
                    message = result switch
                    {
                        FaultMutationResult.Added => "Fault added",
                        FaultMutationResult.Duplicate => "Fault already exists for this target",
                        _ => "Fault target is invalid"
                    };
                }
            }
            else if (command.Action.Equals("clear-fault", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(command.TargetId))
            {
                accepted = simulator.ClearFaultByTarget(command.ControllerId, command.TargetId, out state);
                message = accepted ? "Fault cleared" : "Fault not found";
            }

            if (accepted && state is not null)
                outbound?.Writer.TryWrite(state);

            var ack = new DeviceCommandAck(command.CommandId, command.ControllerId, accepted, message, state, DateTimeOffset.UtcNow);
            await PublishAckAsync(command.ControllerId, command.CommandId, ack);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not process MQTT device command");
        }
    }
}

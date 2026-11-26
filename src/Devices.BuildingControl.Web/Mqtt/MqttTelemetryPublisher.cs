using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Devices.Contracts;
using MQTTnet;
using MQTTnet.Protocol;

public sealed class MqttTelemetryPublisher : IHostedService
{
    private readonly ILogger<MqttTelemetryPublisher> logger;
    private readonly IConfiguration configuration;
    private readonly ISimulatedDeviceConnector simulator;
    private readonly BuildingDesignStore designStore;
    private readonly MqttCredentials? credentials;
    private IMqttClient? client;
    private Channel<ControllerState>? outbound;
    private CancellationTokenSource? publisherCts;
    private Task? publisherTask;
    private readonly object statusGate = new();
    private bool mqttConnected;
    private DateTimeOffset? lastMqttConnectedAt;
    private long nextCleanupTicks;

    public MqttTelemetryPublisher(ILogger<MqttTelemetryPublisher> logger, IConfiguration configuration,
        ISimulatedDeviceConnector simulator, BuildingDesignStore designStore)
    {
        this.logger = logger;
        this.configuration = configuration;
        this.simulator = simulator;
        this.designStore = designStore;
        credentials = MqttCredentials.FromConfiguration(configuration["Mqtt:Username"], configuration["Mqtt:Password"]);
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
                }, requireCurrent: false);
            }
            await client.DisconnectAsync(cancellationToken: cancellationToken);
        }
    }

    public Task PublishAsync(ControllerState state)
    {
        outbound?.Writer.TryWrite(state);
        return Task.CompletedTask;
    }

    public void RequestCleanup() => Interlocked.Exchange(ref nextCleanupTicks, 0);

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
                    if (DateTime.UtcNow.Ticks >= Interlocked.Read(ref nextCleanupTicks))
                    {
                        Interlocked.Exchange(ref nextCleanupTicks, DateTime.UtcNow.AddSeconds(5).Ticks);
                        try
                        {
                            await ProcessCleanupAsync(cancellationToken);
                        }
                        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                        {
                            throw;
                        }
                        catch (Exception exception)
                        {
                            logger.LogWarning(exception, "Could not read or update MQTT cleanup work; it will be retried");
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
            var builder = new MqttClientOptionsBuilder()
                .WithTcpServer(host, port)
                .WithWillTopic("building/controllers/lwt")
                .WithWillPayload("offline")
                .WithWillRetain(true);
            if (credentials is not null) builder.WithCredentials(credentials.Username, credentials.Password);
            var options = builder.Build();
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

    private async Task PublishRetainedAsync(ControllerState state, bool requireCurrent = true)
    {
        var mqttClient = client;
        if (mqttClient is null || !mqttClient.IsConnected) return;
        if (requireCurrent && simulator.GetController(state.Id)?.Revision != state.Revision) return;
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
            await mqttClient.PublishAsync(message);
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

    private async Task ProcessCleanupAsync(CancellationToken cancellationToken)
    {
        var mqttClient = client;
        if (mqttClient is null || !mqttClient.IsConnected) return;
        await ControllerCleanupProcessor.ProcessAsync(designStore, simulator, async (controllerId, token) =>
        {
            var message = new MqttApplicationMessageBuilder()
                .WithTopic($"building/controllers/{controllerId}/telemetry")
                .WithPayload(Array.Empty<byte>())
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
                .WithRetainFlag()
                .Build();
            var result = await mqttClient.PublishAsync(message, token);
            if (!result.IsSuccess)
                throw new InvalidOperationException($"MQTT cleanup was rejected: {result.ReasonCode}.");
        }, logger, cancellationToken);
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

            if (!MqttCommandRouting.IsValid(args.ApplicationMessage.Topic, command))
            {
                logger.LogWarning("Rejected an MQTT command with an invalid topic, controller or command ID");
                return;
            }

            ControllerState? state = null;
            var accepted = false;
            var message = "Unsupported command";

            if (command.Action.Equals("trigger", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(command.RoomId))
            {
                var result = simulator.TriggerSensorForController(command.ControllerId, command.RoomId, out state);
                accepted = result == SensorTriggerResult.Triggered;
                message = result switch
                {
                    SensorTriggerResult.Triggered => "Sensor triggered",
                    SensorTriggerResult.SensorFaulted => "Room sensor has an active fault",
                    _ => "Room is not owned by the addressed controller"
                };
            }
            else if (command.Action.Equals("reset", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(command.RoomId))
            {
                accepted = simulator.ResetSensorForController(command.ControllerId, command.RoomId, out state);
                message = accepted ? "Sensor reset" : "Room is not owned by the addressed controller";
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

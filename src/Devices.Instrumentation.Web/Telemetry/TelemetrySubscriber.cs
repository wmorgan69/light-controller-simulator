using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Devices.Contracts;
using MQTTnet;

/// <summary>Connection status and the configured HTTP polling origin, without credentials or paths.</summary>
public sealed record InstrumentationTransportStatus(
    bool MqttConnected,
    bool HttpAvailable,
    DateTimeOffset? LastMqttConnectedAt,
    string Message,
    string? SimulatorHttpSource);

public sealed class TelemetrySubscriber : IHostedService
{
    private readonly ILogger<TelemetrySubscriber> logger;
    private readonly IConfiguration configuration;
    private readonly TelemetryStore store;
    private IMqttClient? client;
    private CancellationTokenSource? pollingCts;
    private Task? pollingTask;
    private Task? reconnectTask;
    private readonly object statusGate = new();
    private bool mqttConnected;
    private DateTimeOffset? lastMqttConnectedAt;
    private bool httpAvailable = false;
    private DateTimeOffset? lastHttpSuccessAt;

    public TelemetrySubscriber(ILogger<TelemetrySubscriber> logger, IConfiguration configuration, TelemetryStore store)
    {
        this.logger = logger;
        this.configuration = configuration;
        this.store = store;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await ConnectAsync(cancellationToken);
        pollingCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        pollingTask = PollSimulatorAsync(pollingCts.Token);
        reconnectTask = ReconnectAsync(pollingCts.Token);
    }

    private string SimulatorBaseUrl => configuration["Telemetry:SimulatorBaseUrl"] ?? "http://localhost:5080";

    public InstrumentationTransportStatus Status
    {
        get
        {
            lock (statusGate)
            {
                var source = Uri.TryCreate(SimulatorBaseUrl, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
                    ? uri.GetComponents(UriComponents.SchemeAndServer, UriFormat.UriEscaped)
                    : null;
                return new InstrumentationTransportStatus(
                    mqttConnected,
                    httpAvailable,
                    lastMqttConnectedAt,
                    mqttConnected
                        ? "MQTT connected"
                        : httpAvailable
                            ? "MQTT unavailable; HTTP fallback active"
                            : "MQTT unavailable; HTTP fallback unavailable",
                    source);
            }
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        pollingCts?.Cancel();
        if (pollingTask is not null)
        {
            try { await pollingTask.WaitAsync(cancellationToken); }
            catch (OperationCanceledException) { }
        }
        if (reconnectTask is not null)
        {
            try { await reconnectTask.WaitAsync(cancellationToken); }
            catch (OperationCanceledException) { }
        }
        if (client is not null)
            await client.DisconnectAsync(cancellationToken: cancellationToken);
    }

    private async Task ReconnectAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                if (client is null || !client.IsConnected)
                    await ConnectAsync(cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task PollSimulatorAsync(CancellationToken cancellationToken)
    {
        using var http = new HttpClient { BaseAddress = new Uri(SimulatorBaseUrl), Timeout = TimeSpan.FromSeconds(3) };
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(http, cancellationToken);
                lock (statusGate)
                {
                    httpAvailable = true;
                    lastHttpSuccessAt = DateTimeOffset.UtcNow;
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                lock (statusGate) httpAvailable = false;
                logger.LogDebug(exception, "Simulator HTTP fallback unavailable");
            }

            try { await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    public async Task PollOnceAsync(HttpClient http, CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync("/api/controller-snapshot", cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            using var legacy = await http.GetAsync("/api/controllers", cancellationToken);
            legacy.EnsureSuccessStatusCode();
            await using var legacyStream = await legacy.Content.ReadAsStreamAsync(cancellationToken);
            var controllers = await JsonSerializer.DeserializeAsync<List<ControllerState>>(legacyStream, InputJsonOptions, cancellationToken)
                ?? throw new InvalidDataException("Simulator returned a null controller list.");
            store.ApplyLegacyControllers(controllers);
            return;
        }

        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Object ||
            !document.RootElement.TryGetProperty("revision", out var revision) ||
            !revision.TryGetInt64(out _) ||
            !document.RootElement.TryGetProperty("controllers", out var controllersElement) ||
            controllersElement.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("Simulator returned an invalid controller snapshot.");
        var snapshot = document.RootElement.Deserialize<BuildingControllerSnapshot>(InputJsonOptions)
            ?? throw new InvalidDataException("Simulator returned a null controller snapshot.");
        if (!store.ApplySnapshot(snapshot))
            throw new InvalidDataException("Simulator returned a stale controller snapshot.");
    }

    private static readonly JsonSerializerOptions InputJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        RespectRequiredConstructorParameters = true
    };

    public void ProcessTelemetryMessage(string? topic, string json)
    {
        try
        {
            var telemetry = JsonSerializer.Deserialize<DeviceTelemetry>(json, InputJsonOptions);
            var parts = topic?.Split('/');
            if (parts is not { Length: 4 } ||
                parts[0] != "building" || parts[1] != "controllers" || parts[3] != "telemetry" ||
                string.IsNullOrWhiteSpace(parts[2]) || parts[2].IndexOfAny(['+', '#', '\0']) >= 0 ||
                !TelemetryStore.ValidTelemetry(telemetry) || parts[2] != telemetry!.ControllerId)
            {
                logger.LogWarning("Rejected telemetry with an invalid topic, identity, or state");
                return;
            }
            store.Ingest(telemetry);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not process telemetry message");
        }
    }

    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        try
        {
            client ??= new MqttClientFactory().CreateMqttClient();
            client.ApplicationMessageReceivedAsync += args =>
            {
                ProcessTelemetryMessage(args.ApplicationMessage.Topic, Encoding.UTF8.GetString(args.ApplicationMessage.Payload));
                return Task.CompletedTask;
            };

            var host = configuration["Mqtt:Host"] ?? "localhost";
            var port = configuration.GetValue("Mqtt:Port", 1883);
            var options = new MqttClientOptionsBuilder().WithTcpServer(host, port).Build();
            await client.ConnectAsync(options, cancellationToken);
            await client.SubscribeAsync("building/controllers/+/telemetry");
            lock (statusGate)
            {
                mqttConnected = true;
                lastMqttConnectedAt = DateTimeOffset.UtcNow;
            }
        }
        catch (Exception exception)
        {
            lock (statusGate) mqttConnected = false;
            client?.Dispose();
            client = null;
            logger.LogWarning(exception, "MQTT broker unavailable; reconnect will be attempted when telemetry arrives");
        }
    }
}

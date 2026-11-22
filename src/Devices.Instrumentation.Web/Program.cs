using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Devices.Contracts;
using Microsoft.Data.Sqlite;
using MQTTnet;

var builder = WebApplication.CreateBuilder(args);
var configuredSqlitePath = builder.Configuration["Telemetry:SqlitePath"] ?? "telemetry.db";
builder.Configuration["Telemetry:SqlitePath"] = Path.IsPathRooted(configuredSqlitePath)
    ? configuredSqlitePath
    : Path.Combine(builder.Environment.ContentRootPath, configuredSqlitePath);
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

public sealed class TelemetryStore
{
    private readonly object gate = new();
    private readonly string connectionString;
    private readonly Dictionary<string, ControllerState> latest = new();
    private readonly Dictionary<string, DateTimeOffset> lastObserved = new();
    private readonly List<DeviceTelemetry> events = new();
    private readonly TimeSpan staleAfter;

    public TelemetryStore(IConfiguration configuration)
    {
        var path = configuration["Telemetry:SqlitePath"] ?? "telemetry.db";
        staleAfter = TimeSpan.FromSeconds(configuration.GetValue("Telemetry:StaleAfterSeconds", 30));
        connectionString = new SqliteConnectionStringBuilder { DataSource = path }.ToString();
        Initialize();
    }

    public void Ingest(DeviceTelemetry telemetry)
    {
        var accepted = false;
        lock (gate)
        {
            if (latest.TryGetValue(telemetry.ControllerId, out var existing))
            {
                if (telemetry.State.Revision < existing.Revision)
                    return;
                if (telemetry.State.Revision == existing.Revision)
                {
                    var existingJson = JsonSerializer.Serialize(existing, JsonOptions);
                    var incomingJson = JsonSerializer.Serialize(telemetry.State, JsonOptions);
                    if (existingJson == incomingJson)
                        return;
                }
            }
            latest[telemetry.ControllerId] = telemetry.State;
            lastObserved[telemetry.ControllerId] = DateTimeOffset.UtcNow;
            events.Insert(0, telemetry);
            if (events.Count > 500) events.RemoveAt(events.Count - 1);
            accepted = true;
        }
        if (accepted) Persist(telemetry);
    }

    public void IngestFallbackChange(DeviceTelemetry telemetry)
    {
        var accepted = false;
        lock (gate)
        {
            latest[telemetry.ControllerId] = telemetry.State;
            lastObserved[telemetry.ControllerId] = DateTimeOffset.UtcNow;
            events.Insert(0, telemetry);
            if (events.Count > 500) events.RemoveAt(events.Count - 1);
            accepted = true;
        }
        if (accepted) Persist(telemetry);
    }

    public void Observe(string controllerId)
    {
        var observedAt = DateTimeOffset.UtcNow;
        lock (gate)
        {
            if (latest.ContainsKey(controllerId))
                lastObserved[controllerId] = observedAt;
            else
                return;
        }
        PersistObservation(controllerId, observedAt);
    }

    public IReadOnlyList<ControllerState> GetSnapshot()
    {
        lock (gate)
        {
            var now = DateTimeOffset.UtcNow;
            return latest.Values
                .Select(state => ApplyStaleStatus(state, now))
                .OrderBy(state => state.Floor)
                .ToArray();
        }
    }

    public ControllerState? GetController(string controllerId)
    {
        lock (gate)
        {
            if (!latest.TryGetValue(controllerId, out var state)) return null;
            return ApplyStaleStatus(state, DateTimeOffset.UtcNow);
        }
    }

    public IReadOnlyList<DeviceTelemetry> GetEvents()
    {
        lock (gate) return events.ToArray();
    }

    private ControllerState ApplyStaleStatus(ControllerState state, DateTimeOffset now)
    {
        if (!lastObserved.TryGetValue(state.Id, out var observed)) return state;
        if (now - observed <= staleAfter || state.Status == ControllerStatus.Offline) return state;
        return state with { Status = ControllerStatus.Offline };
    }

    private void Initialize()
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS telemetry_events (
                event_id TEXT PRIMARY KEY,
                controller_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS controller_latest (
                controller_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS controller_observed (
                controller_id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
            );
            """;
        command.ExecuteNonQuery();

        command.CommandText = "SELECT payload FROM controller_latest";
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                var state = JsonSerializer.Deserialize<ControllerState>(reader.GetString(0), JsonOptions);
                if (state is not null) latest[state.Id] = state;
            }
        }

        command.CommandText = "SELECT controller_id, timestamp FROM controller_observed";
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                if (DateTimeOffset.TryParse(reader.GetString(1), out var observed))
                    lastObserved[reader.GetString(0)] = observed;
            }
        }

        command.CommandText = """
            SELECT payload
            FROM telemetry_events
            ORDER BY timestamp DESC
            LIMIT 500
            """;
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                var telemetry = JsonSerializer.Deserialize<DeviceTelemetry>(reader.GetString(0), JsonOptions);
                if (telemetry is not null)
                    events.Insert(0, telemetry);
            }
            events.Sort((left, right) => right.Timestamp.CompareTo(left.Timestamp));
        }

        foreach (var controllerId in latest.Keys)
            lastObserved.TryAdd(controllerId, DateTimeOffset.UtcNow);
    }

    private void PersistObservation(string controllerId, DateTimeOffset observedAt)
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT OR REPLACE INTO controller_observed (controller_id, timestamp)
            VALUES ($controllerId, $timestamp)
            """;
        command.Parameters.AddWithValue("$controllerId", controllerId);
        command.Parameters.AddWithValue("$timestamp", observedAt.ToString("O"));
        command.ExecuteNonQuery();
    }

    private void Persist(DeviceTelemetry telemetry)
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var transaction = connection.BeginTransaction();

        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT OR REPLACE INTO telemetry_events (event_id, controller_id, event_type, timestamp, payload)
                VALUES ($eventId, $controllerId, $eventType, $timestamp, $payload)
                """;
            command.Parameters.AddWithValue("$eventId", telemetry.EventId);
            command.Parameters.AddWithValue("$controllerId", telemetry.ControllerId);
            command.Parameters.AddWithValue("$eventType", telemetry.EventType);
            command.Parameters.AddWithValue("$timestamp", telemetry.Timestamp.ToString("O"));
            command.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(telemetry, JsonOptions));
            command.ExecuteNonQuery();
        }

        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT OR REPLACE INTO controller_latest (controller_id, payload)
                VALUES ($controllerId, $payload)
                """;
            command.Parameters.AddWithValue("$controllerId", telemetry.ControllerId);
            command.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(telemetry.State, JsonOptions));
            command.ExecuteNonQuery();
        }

        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT OR REPLACE INTO controller_observed (controller_id, timestamp)
                VALUES ($controllerId, $timestamp)
                """;
            command.Parameters.AddWithValue("$controllerId", telemetry.ControllerId);
            command.Parameters.AddWithValue("$timestamp", DateTimeOffset.UtcNow.ToString("O"));
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}

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

    public DeviceTransportStatus Status
    {
        get
        {
            lock (statusGate)
            {
                return new DeviceTransportStatus(
                    mqttConnected,
                    httpAvailable,
                    lastMqttConnectedAt,
                    mqttConnected
                        ? "MQTT connected"
                        : httpAvailable
                            ? "MQTT unavailable; HTTP fallback active"
                            : "MQTT unavailable; HTTP fallback unavailable");
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
        var baseUrl = configuration["Telemetry:SimulatorBaseUrl"] ?? "http://localhost:5080";
        using var http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(3) };
        var lastStates = new Dictionary<string, string>(StringComparer.Ordinal);

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var response = await http.GetAsync("/api/controllers", cancellationToken);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                var controllers = await JsonSerializer.DeserializeAsync<List<ControllerState>>(stream,
                    new JsonSerializerOptions(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } },
                    cancellationToken);
                if (controllers is not null)
                {
                    foreach (var controller in controllers)
                    {
                        var stateJson = JsonSerializer.Serialize(controller, new JsonSerializerOptions(JsonSerializerDefaults.Web)
                        {
                            Converters = { new JsonStringEnumConverter() }
                        });
                        if (lastStates.TryGetValue(controller.Id, out var previous) && previous == stateJson)
                        {
                            store.Observe(controller.Id);
                            continue;
                        }
                        lastStates[controller.Id] = stateJson;
                        store.IngestFallbackChange(new DeviceTelemetry(
                            $"http-{controller.Id}-{Guid.NewGuid():N}",
                            controller.Id,
                            controller.Faults.Count == 0 ? "state.changed" : "fault.changed",
                            DateTimeOffset.UtcNow,
                            controller));
                    }
                }
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

    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        try
        {
            client ??= new MqttClientFactory().CreateMqttClient();
            client.ApplicationMessageReceivedAsync += args =>
            {
                try
                {
                    var json = Encoding.UTF8.GetString(args.ApplicationMessage.Payload);
                    var telemetry = JsonSerializer.Deserialize<DeviceTelemetry>(json,
                        new JsonSerializerOptions(JsonSerializerDefaults.Web)
                        {
                            Converters = { new JsonStringEnumConverter() }
                        });
                    if (telemetry is not null) store.Ingest(telemetry);
                }
                catch (Exception exception)
                {
                    logger.LogWarning(exception, "Could not process telemetry message");
                }
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

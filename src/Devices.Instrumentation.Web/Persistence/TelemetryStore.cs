using System.Text.Json;
using System.Text.Json.Serialization;
using Devices.Contracts;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

public sealed class TelemetryStore
{
    private readonly object gate = new();
    private readonly ILogger<TelemetryStore> logger;
    private readonly string connectionString;
    private readonly Dictionary<string, ControllerState> latest = new();
    private readonly Dictionary<string, DateTimeOffset> lastObserved = new();
    private readonly List<DeviceTelemetry> events = new();
    private readonly HashSet<string> tombstones = new(StringComparer.Ordinal);
    private readonly HashSet<string> authoritativeIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> lastHttpStates = new(StringComparer.Ordinal);
    private long? designRevision;
    private readonly TimeSpan staleAfter;

    public TelemetryStore(IConfiguration configuration, ILogger<TelemetryStore>? logger = null)
    {
        this.logger = logger ?? NullLogger<TelemetryStore>.Instance;
        var path = configuration["Telemetry:SqlitePath"] ?? "telemetry.db";
        staleAfter = TimeSpan.FromSeconds(configuration.GetValue("Telemetry:StaleAfterSeconds", 30));
        connectionString = new SqliteConnectionStringBuilder { DataSource = path }.ToString();
        Initialize();
    }

    public void Ingest(DeviceTelemetry telemetry)
    {
        lock (gate)
        {
            if (!CanAccept(telemetry)) return;
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
            var observedAt = DateTimeOffset.UtcNow;
            Persist(telemetry, observedAt);
            RecordInMemory(telemetry, observedAt);
        }
    }

    public void IngestFallbackChange(DeviceTelemetry telemetry)
    {
        lock (gate)
        {
            if (!CanAccept(telemetry)) return;
            var observedAt = DateTimeOffset.UtcNow;
            Persist(telemetry, observedAt);
            RecordInMemory(telemetry, observedAt);
        }
    }

    public void Observe(string controllerId)
    {
        var observedAt = DateTimeOffset.UtcNow;
        lock (gate)
        {
            if (!latest.ContainsKey(controllerId)) return;
            PersistObservation(controllerId, observedAt);
            lastObserved[controllerId] = observedAt;
        }
    }

    private bool CanAccept(DeviceTelemetry telemetry) =>
        telemetry.State is not null && telemetry.ControllerId == telemetry.State.Id &&
        !tombstones.Contains(telemetry.ControllerId) &&
        (designRevision is null || authoritativeIds.Contains(telemetry.ControllerId));

    private void RecordInMemory(DeviceTelemetry telemetry, DateTimeOffset observedAt)
    {
        latest[telemetry.ControllerId] = telemetry.State;
        lastObserved[telemetry.ControllerId] = observedAt;
        events.Insert(0, telemetry);
        if (events.Count > 500) events.RemoveAt(events.Count - 1);
    }

    public bool ApplySnapshot(BuildingControllerSnapshot snapshot)
    {
        if (snapshot.Revision < 0 || snapshot.Controllers is null)
            throw new InvalidDataException("Invalid controller snapshot.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var controller in snapshot.Controllers)
            if (!ValidController(controller) || !ids.Add(controller.Id))
                throw new InvalidDataException("Controller snapshot contains an invalid controller or duplicate ID.");

        lock (gate)
        {
            if (designRevision is not null && snapshot.Revision < designRevision) return false;
            if (snapshot.Revision == designRevision && !ids.SetEquals(authoritativeIds))
                throw new InvalidDataException("Controller membership changed without a design revision.");
            if (ids.Overlaps(tombstones))
                throw new InvalidDataException("Controller snapshot reuses a retired ID.");

            var removed = latest.Keys.Concat(authoritativeIds).Where(id => !ids.Contains(id))
                .Distinct(StringComparer.Ordinal).ToArray();
            var observedAt = DateTimeOffset.UtcNow;
            var updates = PrepareHttpUpdates(snapshot.Controllers, observedAt);
            using var connection = new SqliteConnection(connectionString);
            connection.Open();
            using var transaction = connection.BeginTransaction();
            using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT OR REPLACE INTO controller_design_revision (singleton, revision) VALUES (1, $revision);
                    DELETE FROM controller_authoritative;
                    """;
                command.Parameters.AddWithValue("$revision", snapshot.Revision);
                command.ExecuteNonQuery();
                foreach (var id in ids)
                {
                    command.CommandText = "INSERT INTO controller_authoritative (controller_id) VALUES ($id)";
                    command.Parameters.Clear();
                    command.Parameters.AddWithValue("$id", id);
                    command.ExecuteNonQuery();
                }
                foreach (var id in removed)
                {
                    command.CommandText = """
                        INSERT OR IGNORE INTO controller_tombstones (controller_id) VALUES ($id);
                        DELETE FROM controller_latest WHERE controller_id = $id;
                        DELETE FROM controller_observed WHERE controller_id = $id;
                        """;
                    command.Parameters.Clear();
                    command.Parameters.AddWithValue("$id", id);
                    command.ExecuteNonQuery();
                }
            }
            foreach (var update in updates)
            {
                if (update.Telemetry is not null) Persist(connection, transaction, update.Telemetry, observedAt);
                else PersistObservation(connection, transaction, update.Controller.Id, observedAt);
            }
            transaction.Commit();

            designRevision = snapshot.Revision;
            authoritativeIds.Clear();
            authoritativeIds.UnionWith(ids);
            foreach (var id in removed)
            {
                tombstones.Add(id);
                latest.Remove(id);
                lastObserved.Remove(id);
                lastHttpStates.Remove(id);
            }
            ApplyHttpUpdates(updates, observedAt);
            return true;
        }
    }

    public void ApplyLegacyControllers(IReadOnlyList<ControllerState> controllers)
    {
        if (controllers is null || controllers.Any(c => !ValidController(c)) ||
            controllers.Select(c => c.Id).Distinct(StringComparer.Ordinal).Count() != controllers.Count)
            throw new InvalidDataException("Invalid controller list.");
        lock (gate)
        {
            var eligible = controllers.Where(c => !tombstones.Contains(c.Id) &&
                (designRevision is null || authoritativeIds.Contains(c.Id))).ToArray();
            var observedAt = DateTimeOffset.UtcNow;
            var updates = PrepareHttpUpdates(eligible, observedAt);
            using var connection = new SqliteConnection(connectionString);
            connection.Open();
            using var transaction = connection.BeginTransaction();
            foreach (var update in updates)
            {
                if (update.Telemetry is not null) Persist(connection, transaction, update.Telemetry, observedAt);
                else PersistObservation(connection, transaction, update.Controller.Id, observedAt);
            }
            transaction.Commit();
            ApplyHttpUpdates(updates, observedAt);
        }
    }

    internal static bool ValidController(ControllerState? controller) =>
        controller is not null && !string.IsNullOrWhiteSpace(controller.Id) &&
        Enum.IsDefined(controller.Status) &&
        controller.Rooms is not null && controller.Faults is not null &&
        controller.Rooms.All(room =>
            room is not null && !string.IsNullOrWhiteSpace(room.Id) &&
            !string.IsNullOrWhiteSpace(room.Name) && !string.IsNullOrWhiteSpace(room.ControllerId) &&
            room.ControllerId == controller.Id &&
            room.LightStrips is not null && room.LightStrips.All(strip =>
                strip is not null && !string.IsNullOrWhiteSpace(strip.Id) &&
                !string.IsNullOrWhiteSpace(strip.RoomId) && strip.RoomId == room.Id)) &&
        controller.Faults.All(fault =>
            fault is not null && !string.IsNullOrWhiteSpace(fault.Id) &&
            !string.IsNullOrWhiteSpace(fault.Scope) && !string.IsNullOrWhiteSpace(fault.TargetId) &&
            !string.IsNullOrWhiteSpace(fault.Description));

    internal static bool ValidTelemetry(DeviceTelemetry? telemetry) =>
        telemetry is not null && !string.IsNullOrWhiteSpace(telemetry.EventId) &&
        !string.IsNullOrWhiteSpace(telemetry.EventType) &&
        !string.IsNullOrWhiteSpace(telemetry.ControllerId) &&
        ValidController(telemetry.State) && telemetry.ControllerId == telemetry.State.Id;

    private List<(ControllerState Controller, string Json, DeviceTelemetry? Telemetry)> PrepareHttpUpdates(
        IEnumerable<ControllerState> controllers, DateTimeOffset observedAt)
    {
        var updates = new List<(ControllerState, string, DeviceTelemetry?)>();
        foreach (var controller in controllers)
        {
            var json = JsonSerializer.Serialize(controller, JsonOptions);
            DeviceTelemetry? telemetry = null;
            if (!lastHttpStates.TryGetValue(controller.Id, out var previous) || previous != json || !latest.ContainsKey(controller.Id))
                telemetry = new DeviceTelemetry($"http-{controller.Id}-{Guid.NewGuid():N}", controller.Id,
                    controller.Faults.Count == 0 ? "state.changed" : "fault.changed", observedAt, controller);
            updates.Add((controller, json, telemetry));
        }
        return updates;
    }

    private void ApplyHttpUpdates(List<(ControllerState Controller, string Json, DeviceTelemetry? Telemetry)> updates, DateTimeOffset observedAt)
    {
        foreach (var update in updates)
        {
            lastHttpStates[update.Controller.Id] = update.Json;
            if (update.Telemetry is not null) RecordInMemory(update.Telemetry, observedAt);
            else lastObserved[update.Controller.Id] = observedAt;
        }
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
            CREATE TABLE IF NOT EXISTS controller_design_revision (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                revision INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS controller_authoritative (controller_id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS controller_tombstones (controller_id TEXT PRIMARY KEY);
            """;
        command.ExecuteNonQuery();

        command.CommandText = "SELECT revision FROM controller_design_revision WHERE singleton = 1";
        var revision = command.ExecuteScalar();
        if (revision is not null) designRevision = Convert.ToInt64(revision);
        command.CommandText = "SELECT controller_id FROM controller_authoritative";
        using (var reader = command.ExecuteReader())
            while (reader.Read()) authoritativeIds.Add(reader.GetString(0));
        command.CommandText = "SELECT controller_id FROM controller_tombstones";
        using (var reader = command.ExecuteReader())
            while (reader.Read()) tombstones.Add(reader.GetString(0));

        command.CommandText = "SELECT controller_id, payload FROM controller_latest";
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                ControllerState? state;
                try { state = JsonSerializer.Deserialize<ControllerState>(reader.GetString(1), JsonOptions); }
                catch (JsonException)
                {
                    logger.LogWarning("Rejected malformed persisted controller state");
                    continue;
                }
                if (!ValidController(state) || state!.Id != reader.GetString(0))
                {
                    logger.LogWarning("Rejected invalid persisted controller state");
                    continue;
                }
                latest[state.Id] = state;
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
            SELECT event_id, controller_id, payload
            FROM telemetry_events
            ORDER BY timestamp DESC
            LIMIT 500
            """;
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                DeviceTelemetry? telemetry;
                try { telemetry = JsonSerializer.Deserialize<DeviceTelemetry>(reader.GetString(2), JsonOptions); }
                catch (JsonException)
                {
                    logger.LogWarning("Rejected malformed persisted telemetry event");
                    continue;
                }
                if (!ValidTelemetry(telemetry) || telemetry!.EventId != reader.GetString(0) ||
                    telemetry.ControllerId != reader.GetString(1))
                {
                    logger.LogWarning("Rejected invalid persisted telemetry event");
                    continue;
                }
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
        PersistObservation(connection, null, controllerId, observedAt);
    }

    private static void PersistObservation(SqliteConnection connection, SqliteTransaction? transaction, string controllerId, DateTimeOffset observedAt)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT OR REPLACE INTO controller_observed (controller_id, timestamp)
            VALUES ($controllerId, $timestamp)
            """;
        command.Parameters.AddWithValue("$controllerId", controllerId);
        command.Parameters.AddWithValue("$timestamp", observedAt.ToString("O"));
        command.ExecuteNonQuery();
    }

    private void Persist(DeviceTelemetry telemetry, DateTimeOffset observedAt)
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Persist(connection, transaction, telemetry, observedAt);
        transaction.Commit();
    }

    private static void Persist(SqliteConnection connection, SqliteTransaction transaction, DeviceTelemetry telemetry, DateTimeOffset observedAt)
    {
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
            command.Parameters.AddWithValue("$timestamp", observedAt.ToString("O"));
            command.ExecuteNonQuery();
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            RespectRequiredConstructorParameters = true
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}


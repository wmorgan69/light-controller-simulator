using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Devices.Contracts;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

public sealed class TelemetryStore
{
    private const int SchemaVersion = 1;
    private const long MigrationLockId = 75772026001;
    private const string MigrationResourceName = "Devices.Instrumentation.Web.Migrations.001_initial.sql";
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
        var connectionString = configuration.GetConnectionString("Telemetry");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("ConnectionStrings:Telemetry must be configured.");
        staleAfter = TimeSpan.FromSeconds(configuration.GetValue("Telemetry:StaleAfterSeconds", 30));
        this.connectionString = connectionString;
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
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();

            using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT INTO telemetry.controller_design_revision (singleton, revision)
                    VALUES (true, @revision)
                    ON CONFLICT (singleton) DO UPDATE SET revision = EXCLUDED.revision
                    """;
                command.Parameters.AddWithValue("revision", snapshot.Revision);
                command.ExecuteNonQuery();
            }
            using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = "DELETE FROM telemetry.controller_authoritative";
                command.ExecuteNonQuery();
            }

            foreach (var id in removed)
            {
                using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT INTO telemetry.controller_tombstones (controller_id) VALUES (@id)
                    ON CONFLICT (controller_id) DO NOTHING
                    """;
                command.Parameters.AddWithValue("id", id);
                command.ExecuteNonQuery();

                command.CommandText = "DELETE FROM telemetry.controller_latest WHERE controller_id = @id";
                command.ExecuteNonQuery();
            }

            foreach (var update in updates)
            {
                if (update.Telemetry is not null) Persist(connection, transaction, update.Telemetry, observedAt);
                else PersistObservation(connection, transaction, update.Controller.Id, observedAt);
            }
            foreach (var id in ids)
            {
                using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT INTO telemetry.controller_authoritative (controller_id) VALUES (@id)
                    ON CONFLICT (controller_id) DO NOTHING;
                    """;
                command.Parameters.AddWithValue("id", id);
                command.ExecuteNonQuery();
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
            using var connection = OpenConnection();
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
        using var connection = OpenConnection();
        using var versionCommand = connection.CreateCommand();
        versionCommand.CommandText = "SELECT current_setting('server_version_num')::integer";
        var serverVersion = Convert.ToInt32(versionCommand.ExecuteScalar());
        if (serverVersion < 180000)
            throw new InvalidOperationException("Telemetry persistence requires PostgreSQL 18 or later.");
        Migrate(connection);
        LoadPersistedState(connection);
    }

    private static void Migrate(NpgsqlConnection connection)
    {
        using var transaction = connection.BeginTransaction();
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT pg_advisory_xact_lock(@lockId)";
            command.Parameters.AddWithValue("lockId", MigrationLockId);
            command.ExecuteNonQuery();
        }

        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'telemetry')";
            if (!(bool)command.ExecuteScalar()!)
                throw new InvalidOperationException("The telemetry schema must be provisioned before the application starts.");
        }

        bool hasVersionTable;
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT to_regclass('telemetry.schema_version') IS NOT NULL";
            hasVersionTable = (bool)command.ExecuteScalar()!;
        }

        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT to_regclass('telemetry.schema_migrations') IS NOT NULL";
            if ((bool)command.ExecuteScalar()!)
                throw new InvalidOperationException("The telemetry schema uses the legacy schema_migrations table; it requires an explicit reset before initialization.");
        }

        if (!hasVersionTable)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                SELECT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'telemetry' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
                )
                """;
            if ((bool)command.ExecuteScalar()!)
                throw new InvalidOperationException("The telemetry schema contains unversioned objects; refusing to initialize it.");

            using var migrationCommand = connection.CreateCommand();
            migrationCommand.Transaction = transaction;
            migrationCommand.CommandText = ReadMigration();
            migrationCommand.ExecuteNonQuery();
        }
        else
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT version FROM telemetry.schema_version WHERE singleton = true";
            var version = command.ExecuteScalar();
            if (version is null || version is DBNull)
                throw new InvalidOperationException("The telemetry schema has no migration version; refusing to use an unversioned schema.");
            if (Convert.ToInt32(version) != SchemaVersion)
                throw new InvalidOperationException($"Unsupported telemetry schema version {version}; this application supports version {SchemaVersion}.");
        }

        EnsureSchemaShape(connection, transaction);
        transaction.Commit();
    }

    private static string ReadMigration()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(MigrationResourceName)
            ?? throw new InvalidOperationException($"Embedded telemetry migration '{MigrationResourceName}' was not found.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static void EnsureSchemaShape(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        foreach (var table in new[]
        {
            "schema_version", "telemetry_events", "controller_latest", "controller_observed",
            "controller_design_revision", "controller_authoritative", "controller_tombstones"
        })
        {
            command.CommandText = $"SELECT created_at, updated_at FROM telemetry.{table} LIMIT 0";
            command.ExecuteNonQuery();
            command.CommandText = """
                SELECT (
                    SELECT count(*) = 2 FROM information_schema.columns
                    WHERE table_schema = 'telemetry' AND table_name = @table
                      AND column_name IN ('created_at', 'updated_at')
                      AND data_type = 'timestamp with time zone'
                      AND is_nullable = 'NO' AND column_default = 'clock_timestamp()'
                ) AND EXISTS (
                    SELECT 1 FROM pg_trigger
                    WHERE tgrelid = to_regclass('telemetry.' || @table)
                      AND NOT tgisinternal AND tgtype = 19 AND tgenabled IN ('O', 'A')
                      AND tgqual IS NULL AND cardinality(tgattr::smallint[]) = 0
                      AND tgfoid = to_regprocedure('telemetry.set_updated_at()')
                )
                """;
            command.Parameters.Clear();
            command.Parameters.AddWithValue("table", table);
            if (!(bool)command.ExecuteScalar()!)
                throw new InvalidOperationException($"The telemetry schema has incomplete timestamp tracking on table '{table}'; an explicit reset is required.");
        }
    }

    private void LoadPersistedState(NpgsqlConnection connection)
    {
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT revision FROM telemetry.controller_design_revision WHERE singleton = true";
            var revision = command.ExecuteScalar();
            if (revision is not null && revision is not DBNull) designRevision = Convert.ToInt64(revision);
        }

        ReadIds(connection, "SELECT controller_id FROM telemetry.controller_authoritative", authoritativeIds);
        ReadIds(connection, "SELECT controller_id FROM telemetry.controller_tombstones", tombstones);

        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT controller_id, payload FROM telemetry.controller_latest";
            using var reader = command.ExecuteReader();
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
                lastHttpStates[state.Id] = JsonSerializer.Serialize(state, JsonOptions);
            }
        }

        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT controller_id, observed_at FROM telemetry.controller_observed";
            using var reader = command.ExecuteReader();
            while (reader.Read())
                lastObserved[reader.GetString(0)] = new DateTimeOffset(DateTime.SpecifyKind(reader.GetDateTime(1), DateTimeKind.Utc));
        }

        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT event_id, controller_id, payload
                FROM telemetry.telemetry_events
                ORDER BY timestamp DESC, id DESC
                LIMIT 500
                """;
            using var reader = command.ExecuteReader();
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
                events.Add(telemetry);
            }
        }

        foreach (var controllerId in latest.Keys)
            lastObserved.TryAdd(controllerId, DateTimeOffset.UtcNow);
    }

    private static void ReadIds(NpgsqlConnection connection, string sql, HashSet<string> target)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        using var reader = command.ExecuteReader();
        while (reader.Read()) target.Add(reader.GetString(0));
    }

    private void PersistObservation(string controllerId, DateTimeOffset observedAt)
    {
        using var connection = OpenConnection();
        PersistObservation(connection, null, controllerId, observedAt);
    }

    private static void PersistObservation(NpgsqlConnection connection, NpgsqlTransaction? transaction,
        string controllerId, DateTimeOffset observedAt)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO telemetry.controller_observed (controller_id, observed_at)
            VALUES (@controllerId, @observedAt)
            ON CONFLICT (controller_id) DO UPDATE SET observed_at = EXCLUDED.observed_at
            """;
        command.Parameters.AddWithValue("controllerId", controllerId);
        command.Parameters.AddWithValue("observedAt", observedAt);
        command.ExecuteNonQuery();
    }

    private void Persist(DeviceTelemetry telemetry, DateTimeOffset observedAt)
    {
        using var connection = OpenConnection();
        using var transaction = connection.BeginTransaction();
        Persist(connection, transaction, telemetry, observedAt);
        transaction.Commit();
    }

    private static void Persist(NpgsqlConnection connection, NpgsqlTransaction transaction,
        DeviceTelemetry telemetry, DateTimeOffset observedAt)
    {
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO telemetry.telemetry_events (event_id, controller_id, event_type, timestamp, payload)
                VALUES (@eventId, @controllerId, @eventType, @timestamp, @payload)
                ON CONFLICT (event_id) DO UPDATE SET
                    controller_id = EXCLUDED.controller_id,
                    event_type = EXCLUDED.event_type,
                    timestamp = EXCLUDED.timestamp,
                    payload = EXCLUDED.payload
                """;
            command.Parameters.AddWithValue("eventId", telemetry.EventId);
            command.Parameters.AddWithValue("controllerId", telemetry.ControllerId);
            command.Parameters.AddWithValue("eventType", telemetry.EventType);
            command.Parameters.AddWithValue("timestamp", telemetry.Timestamp.ToUniversalTime());
            command.Parameters.AddWithValue("payload", JsonSerializer.Serialize(telemetry, JsonOptions));
            command.ExecuteNonQuery();
        }

        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO telemetry.controller_latest (controller_id, payload)
                VALUES (@controllerId, @payload)
                ON CONFLICT (controller_id) DO UPDATE SET payload = EXCLUDED.payload
                """;
            command.Parameters.AddWithValue("controllerId", telemetry.ControllerId);
            command.Parameters.AddWithValue("payload", JsonSerializer.Serialize(telemetry.State, JsonOptions));
            command.ExecuteNonQuery();
        }

        PersistObservation(connection, transaction, telemetry.ControllerId, observedAt);
    }

    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    private NpgsqlConnection OpenConnection()
    {
        var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        return connection;
    }

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

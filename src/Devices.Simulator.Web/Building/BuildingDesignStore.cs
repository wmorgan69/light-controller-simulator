using System.Text.Json;
using Microsoft.Data.Sqlite;

public enum BuildingDesignStoreStatus { Success, RevisionConflict, InvalidDesign }
public enum BuildingDesignCleanupStatus { Pending, Completed, Cancelled, Failed }
public sealed record BuildingDesignCleanup(string ControllerId, long ActiveRevision, BuildingDesignCleanupStatus Status);
public sealed record BuildingDesignSnapshot(BuildingDesign Saved, BuildingDesign Active, long EditRevision);
public sealed record BuildingDesignWriteResult(BuildingDesignStoreStatus Status, BuildingDesignSnapshot Snapshot, IReadOnlyList<BuildingDesignValidationError> Errors);

public sealed class BuildingDesignStore
{
    private readonly string connectionString;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public BuildingDesignStore(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (path == ":memory:") throw new ArgumentException("A persistent SQLite file is required.", nameof(path));
        connectionString = new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString();
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var version = ScalarLong(connection, transaction, "PRAGMA user_version");
        if (version == 0)
        {
            if (ScalarLong(connection, transaction, "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") != 0)
                throw new InvalidOperationException("Cannot initialize an unversioned non-empty building design database.");
            Execute(connection, transaction, """
                CREATE TABLE building_design (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    saved TEXT NOT NULL, active TEXT NOT NULL,
                    edit_revision INTEGER NOT NULL
                );
                CREATE TABLE retired_design_id (id TEXT PRIMARY KEY);
                CREATE TABLE controller_cleanup (
                    controller_id TEXT PRIMARY KEY,
                    active_revision INTEGER NOT NULL,
                    status INTEGER NOT NULL
                );
                PRAGMA user_version = 4;
                """);
            var seed = JsonSerializer.Serialize(BuildingDesignSeed.Create(), JsonOptions);
            using var insert = Command(connection, transaction, "INSERT INTO building_design (id, saved, active, edit_revision) VALUES (1, $seed, $seed, 1)");
            insert.Parameters.AddWithValue("$seed", seed);
            insert.ExecuteNonQuery();
            version = 4;
        }
        else if (version is not 1 and not 2 and not 3 and not 4)
            throw new InvalidOperationException($"Unsupported building design schema version {version}.");
        if (version < 2)
        {
            Execute(connection, transaction, """
                CREATE TABLE retired_design_id (id TEXT PRIMARY KEY);
                CREATE TABLE controller_cleanup (
                    controller_id TEXT PRIMARY KEY,
                    active_revision INTEGER NOT NULL,
                    status INTEGER NOT NULL
                );
                PRAGMA user_version = 2;
                """);
            if (version == 1)
            {
                var previous = ReadSnapshot(connection, transaction);
                var savedIds = DesignIds(previous.Saved);
                foreach (var id in DesignIds(previous.Active).Keys.Except(savedIds.Keys, StringComparer.Ordinal))
                {
                    using var retire = Command(connection, transaction, "INSERT OR IGNORE INTO retired_design_id (id) VALUES ($id)");
                    retire.Parameters.AddWithValue("$id", id);
                    retire.ExecuteNonQuery();
                }
            }
        }
        if (version < 3)
        {
            Execute(connection, transaction, """
                ALTER TABLE building_design DROP COLUMN draft;
                PRAGMA user_version = 3;
                """);
        }
        if (version < 4)
        {
            Execute(connection, transaction, """
                ALTER TABLE building_design DROP COLUMN lease_token;
                ALTER TABLE building_design DROP COLUMN lease_expiry;
                PRAGMA user_version = 4;
                """);
        }
        transaction.Commit();
    }

    public BuildingDesignSnapshot Read()
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var snapshot = ReadSnapshot(connection, transaction);
        transaction.Commit();
        return snapshot;
    }

    public BuildingDesignWriteResult ActivateSaved(long expectedSavedRevision)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var snapshot = ReadSnapshot(connection, transaction);
        var status = expectedSavedRevision == snapshot.Saved.Revision
            ? BuildingDesignStoreStatus.Success : BuildingDesignStoreStatus.RevisionConflict;
        if (status != BuildingDesignStoreStatus.Success) return Result(status, snapshot);
        var savedControllers = snapshot.Saved.Floors.Select(f => f.ControllerId).ToHashSet(StringComparer.Ordinal);
        using (var refence = Command(connection, transaction, "UPDATE controller_cleanup SET active_revision = $revision WHERE status IN ($pending, $failed)"))
        {
            refence.Parameters.AddWithValue("$revision", snapshot.Saved.Revision);
            refence.Parameters.AddWithValue("$pending", (int)BuildingDesignCleanupStatus.Pending);
            refence.Parameters.AddWithValue("$failed", (int)BuildingDesignCleanupStatus.Failed);
            refence.ExecuteNonQuery();
        }
        foreach (var controller in snapshot.Active.Floors.Select(f => f.ControllerId).Where(id => !savedControllers.Contains(id)))
        {
            using var enqueue = Command(connection, transaction, """
                INSERT INTO controller_cleanup (controller_id, active_revision, status)
                VALUES ($id, $revision, $pending)
                ON CONFLICT(controller_id) DO UPDATE SET active_revision = excluded.active_revision, status = excluded.status
                """);
            enqueue.Parameters.AddWithValue("$id", controller);
            enqueue.Parameters.AddWithValue("$revision", snapshot.Saved.Revision);
            enqueue.Parameters.AddWithValue("$pending", (int)BuildingDesignCleanupStatus.Pending);
            enqueue.ExecuteNonQuery();
        }
        Execute(connection, transaction, "UPDATE building_design SET active = saved WHERE id = 1");
        var updated = ReadSnapshot(connection, transaction);
        transaction.Commit();
        return Result(status, updated);
    }

    public IReadOnlyList<BuildingDesignCleanup> ReadCleanup()
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = Command(connection, transaction, "SELECT controller_id, active_revision, status FROM controller_cleanup ORDER BY controller_id");
        using var reader = command.ExecuteReader();
        var items = new List<BuildingDesignCleanup>();
        while (reader.Read()) items.Add(new(reader.GetString(0), reader.GetInt64(1), (BuildingDesignCleanupStatus)reader.GetInt32(2)));
        transaction.Commit();
        return items;
    }

    public BuildingDesignStoreStatus CompleteCleanup(string controllerId, long activeRevision) =>
        FinishCleanup(controllerId, activeRevision, BuildingDesignCleanupStatus.Completed);

    public BuildingDesignStoreStatus CancelCleanup(string controllerId, long activeRevision) =>
        FinishCleanup(controllerId, activeRevision, BuildingDesignCleanupStatus.Cancelled);

    public BuildingDesignStoreStatus MarkCleanupFailed(string controllerId, long activeRevision) =>
        FinishCleanup(controllerId, activeRevision, BuildingDesignCleanupStatus.Failed);

    private BuildingDesignStoreStatus FinishCleanup(string controllerId, long activeRevision, BuildingDesignCleanupStatus target)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var snapshot = ReadSnapshot(connection, transaction);
        if (snapshot.Active.Revision != activeRevision || snapshot.Active.Floors.Any(f => f.ControllerId == controllerId))
            return BuildingDesignStoreStatus.RevisionConflict;
        using var command = Command(connection, transaction, """
            UPDATE controller_cleanup SET status = $target
            WHERE controller_id = $id AND active_revision = $revision AND status IN ($pending, $failed)
            """);
        command.Parameters.AddWithValue("$target", (int)target);
        command.Parameters.AddWithValue("$id", controllerId);
        command.Parameters.AddWithValue("$revision", activeRevision);
        command.Parameters.AddWithValue("$pending", (int)BuildingDesignCleanupStatus.Pending);
        command.Parameters.AddWithValue("$failed", (int)BuildingDesignCleanupStatus.Failed);
        if (command.ExecuteNonQuery() != 1)
        {
            using var existing = Command(connection, transaction, """
                SELECT count(*) FROM controller_cleanup
                WHERE controller_id = $id AND active_revision = $revision AND status = $target
                """);
            existing.Parameters.AddWithValue("$id", controllerId);
            existing.Parameters.AddWithValue("$revision", activeRevision);
            existing.Parameters.AddWithValue("$target", (int)target);
            if ((long)existing.ExecuteScalar()! != 1) return BuildingDesignStoreStatus.RevisionConflict;
        }
        transaction.Commit();
        return BuildingDesignStoreStatus.Success;
    }

    public BuildingDesignWriteResult Save(long expectedRevision, BuildingDesign? design)
    {
        using var connection = Open();
        // The default immediate transaction serializes the revision check and all writes.
        using var transaction = connection.BeginTransaction();
        var snapshot = ReadSnapshot(connection, transaction);
        var status = expectedRevision == snapshot.EditRevision
            ? BuildingDesignStoreStatus.Success : BuildingDesignStoreStatus.RevisionConflict;
        if (status != BuildingDesignStoreStatus.Success) return Result(status, snapshot);
        var errors = BuildingDesignValidator.ValidateForSave(design);
        if (errors.Count != 0) return new(BuildingDesignStoreStatus.InvalidDesign, snapshot, errors);
        {
            var oldIds = DesignIds(snapshot.Saved);
            var newIds = DesignIds(design!);
            var idErrors = new List<BuildingDesignValidationError>();
            foreach (var (id, kind) in newIds)
            {
                if (oldIds.TryGetValue(id, out var oldKind) && oldKind != kind)
                    idErrors.Add(new("ids", $"ID '{id}' cannot change entity type."));
                using var lookup = Command(connection, transaction, "SELECT count(*) FROM retired_design_id WHERE id = $id");
                lookup.Parameters.AddWithValue("$id", id);
                if ((long)lookup.ExecuteScalar()! != 0)
                    idErrors.Add(new("ids", $"ID '{id}' is retired and cannot be reused."));
            }
            if (idErrors.Count != 0) return new(BuildingDesignStoreStatus.InvalidDesign, snapshot, idErrors);
            foreach (var id in oldIds.Keys.Except(newIds.Keys, StringComparer.Ordinal))
            {
                using var retire = Command(connection, transaction, "INSERT OR IGNORE INTO retired_design_id (id) VALUES ($id)");
                retire.Parameters.AddWithValue("$id", id);
                retire.ExecuteNonQuery();
            }
        }
        var revision = checked(snapshot.EditRevision + 1);
        var json = JsonSerializer.Serialize(design! with { Revision = revision }, JsonOptions);
        using var command = Command(connection, transaction,
            "UPDATE building_design SET saved = $design, edit_revision = $revision WHERE id = 1");
        command.Parameters.AddWithValue("$design", json);
        command.Parameters.AddWithValue("$revision", revision);
        command.ExecuteNonQuery();
        var updated = ReadSnapshot(connection, transaction);
        transaction.Commit();
        return Result(status, updated);
    }

    private static Dictionary<string, string> DesignIds(BuildingDesign design)
    {
        var ids = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var floor in design.Floors)
        {
            ids.Add(floor.Id, "floor");
            ids.Add(floor.ControllerId, "controller");
            foreach (var room in floor.Rooms)
            {
                ids.Add(room.Id, "room");
                ids.Add(room.Sensor.Id, "sensor");
                foreach (var door in room.Doors) ids.Add(door.Id, "door");
                foreach (var light in room.Lights) ids.Add(light.Id, "light");
            }
        }
        return ids;
    }

    private static BuildingDesignWriteResult Result(BuildingDesignStoreStatus status, BuildingDesignSnapshot snapshot) =>
        new(status, snapshot, Array.Empty<BuildingDesignValidationError>());

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        return connection;
    }

    private static SqliteCommand Command(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        return command;
    }
    private static void Execute(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        using var command = Command(connection, transaction, sql);
        command.ExecuteNonQuery();
    }
    private static long ScalarLong(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        using var command = Command(connection, transaction, sql);
        return (long)command.ExecuteScalar()!;
    }
    private static BuildingDesignSnapshot ReadSnapshot(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var command = Command(connection, transaction, "SELECT saved, active, edit_revision FROM building_design WHERE id = 1");
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw new InvalidOperationException("Building design database is missing its state row.");
        BuildingDesign Parse(int index) => JsonSerializer.Deserialize<BuildingDesign>(reader.GetString(index), JsonOptions)
            ?? throw new InvalidOperationException("Building design database contains an empty design.");
        return new(Parse(0), Parse(1), reader.GetInt64(2));
    }
}

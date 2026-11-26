using System.Text.Json;
using Npgsql;

public enum BuildingDesignStoreStatus { Success, RevisionConflict, InvalidDesign }
public enum BuildingDesignCleanupStatus { Pending, Completed, Cancelled, Failed }
public sealed record BuildingDesignCleanup(string ControllerId, long ActiveRevision, BuildingDesignCleanupStatus Status);
public sealed record BuildingDesignSnapshot(BuildingDesign Saved, BuildingDesign Active, long EditRevision);
public sealed record BuildingDesignWriteResult(BuildingDesignStoreStatus Status, BuildingDesignSnapshot Snapshot, IReadOnlyList<BuildingDesignValidationError> Errors);

public sealed class BuildingDesignStore
{
    private const int SchemaVersion = 1;
    private const string MigrationResourcePrefix = "Devices.BuildingControl.Web.database.control.";
    private const string MigrationFileName = "001_initial.sql";
    private readonly string connectionString;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public BuildingDesignStore(string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        this.connectionString = connectionString;
        Initialize();
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
        var snapshot = ReadSnapshot(connection, transaction, lockForUpdate: true);
        var status = expectedSavedRevision == snapshot.Saved.Revision
            ? BuildingDesignStoreStatus.Success : BuildingDesignStoreStatus.RevisionConflict;
        if (status != BuildingDesignStoreStatus.Success) return Result(status, snapshot);

        var savedControllers = snapshot.Saved.Floors.Select(f => f.ControllerId).ToHashSet(StringComparer.Ordinal);
        using (var refence = Command(connection, transaction, """
            UPDATE control.controller_mqtt_retained_cleanup SET active_design_revision = @revision
            WHERE building_id = (SELECT id FROM control.building WHERE singleton_key = 1)
              AND status IN (@pending, @failed)
            """))
        {
            refence.Parameters.AddWithValue("revision", snapshot.Saved.Revision);
            refence.Parameters.AddWithValue("pending", (short)BuildingDesignCleanupStatus.Pending);
            refence.Parameters.AddWithValue("failed", (short)BuildingDesignCleanupStatus.Failed);
            refence.ExecuteNonQuery();
        }

        foreach (var controller in snapshot.Active.Floors.Select(f => f.ControllerId).Where(id => !savedControllers.Contains(id)))
        {
            using var enqueue = Command(connection, transaction, """
                INSERT INTO control.controller_mqtt_retained_cleanup (building_id, controller_id, active_design_revision, status)
                VALUES ((SELECT id FROM control.building WHERE singleton_key = 1), @id, @revision, @pending)
                ON CONFLICT (controller_id) DO UPDATE
                SET active_design_revision = EXCLUDED.active_design_revision, status = EXCLUDED.status
                """);
            enqueue.Parameters.AddWithValue("id", controller);
            enqueue.Parameters.AddWithValue("revision", snapshot.Saved.Revision);
            enqueue.Parameters.AddWithValue("pending", (short)BuildingDesignCleanupStatus.Pending);
            enqueue.ExecuteNonQuery();
        }

        using (var update = Command(connection, transaction,
            "UPDATE control.building SET active_design_id = saved_design_id WHERE singleton_key = 1"))
            update.ExecuteNonQuery();
        var updated = ReadSnapshot(connection, transaction);
        transaction.Commit();
        return Result(status, updated);
    }

    public IReadOnlyList<BuildingDesignCleanup> ReadCleanup()
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = Command(connection, transaction, """
            SELECT controller_id, active_design_revision, status
            FROM control.controller_mqtt_retained_cleanup
            WHERE building_id = (SELECT id FROM control.building WHERE singleton_key = 1)
            ORDER BY controller_id
            """);
        using var reader = command.ExecuteReader();
        var items = new List<BuildingDesignCleanup>();
        while (reader.Read())
            items.Add(new(reader.GetString(0), reader.GetInt64(1), (BuildingDesignCleanupStatus)reader.GetInt16(2)));
        reader.Close();
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
        var snapshot = ReadSnapshot(connection, transaction, lockForUpdate: true);
        if (snapshot.Active.Revision != activeRevision || snapshot.Active.Floors.Any(f => f.ControllerId == controllerId))
            return BuildingDesignStoreStatus.RevisionConflict;

        using var command = Command(connection, transaction, """
            UPDATE control.controller_mqtt_retained_cleanup SET status = @target
            WHERE building_id = (SELECT id FROM control.building WHERE singleton_key = 1)
              AND controller_id = @id AND active_design_revision = @revision AND status IN (@pending, @failed)
            """);
        command.Parameters.AddWithValue("target", (short)target);
        command.Parameters.AddWithValue("id", controllerId);
        command.Parameters.AddWithValue("revision", activeRevision);
        command.Parameters.AddWithValue("pending", (short)BuildingDesignCleanupStatus.Pending);
        command.Parameters.AddWithValue("failed", (short)BuildingDesignCleanupStatus.Failed);
        if (command.ExecuteNonQuery() != 1)
        {
            using var existing = Command(connection, transaction, """
                SELECT count(*) FROM control.controller_mqtt_retained_cleanup
                WHERE building_id = (SELECT id FROM control.building WHERE singleton_key = 1)
                  AND controller_id = @id AND active_design_revision = @revision AND status = @target
                """);
            existing.Parameters.AddWithValue("id", controllerId);
            existing.Parameters.AddWithValue("revision", activeRevision);
            existing.Parameters.AddWithValue("target", (short)target);
            if ((long)existing.ExecuteScalar()! != 1) return BuildingDesignStoreStatus.RevisionConflict;
        }

        transaction.Commit();
        return BuildingDesignStoreStatus.Success;
    }

    public BuildingDesignWriteResult Save(long expectedRevision, BuildingDesign? design)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var snapshot = ReadSnapshot(connection, transaction, lockForUpdate: true);
        var status = expectedRevision == snapshot.EditRevision
            ? BuildingDesignStoreStatus.Success : BuildingDesignStoreStatus.RevisionConflict;
        if (status != BuildingDesignStoreStatus.Success) return Result(status, snapshot);
        var errors = BuildingDesignValidator.ValidateForSave(design);
        if (errors.Count != 0) return new(BuildingDesignStoreStatus.InvalidDesign, snapshot, errors);

        var oldIds = DesignIds(snapshot.Saved);
        var newIds = DesignIds(design!);
        var idErrors = new List<BuildingDesignValidationError>();
        foreach (var (id, kind) in newIds)
        {
            if (oldIds.TryGetValue(id, out var oldKind) && oldKind != kind)
                idErrors.Add(new("ids", $"ID '{id}' cannot change entity type."));
            using var lookup = Command(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM control.retired_design_entity_id WHERE external_id = @id)");
            lookup.Parameters.AddWithValue("id", id);
            if ((bool)lookup.ExecuteScalar()!)
                idErrors.Add(new("ids", $"ID '{id}' is retired and cannot be reused."));
        }
        if (idErrors.Count != 0) return new(BuildingDesignStoreStatus.InvalidDesign, snapshot, idErrors);

        foreach (var id in oldIds.Keys.Except(newIds.Keys, StringComparer.Ordinal))
        {
            using var retire = Command(connection, transaction, """
                INSERT INTO control.retired_design_entity_id (building_id, external_id, entity_type)
                VALUES ((SELECT id FROM control.building WHERE singleton_key = 1), @id, @type)
                ON CONFLICT (external_id) DO NOTHING
                """);
            retire.Parameters.AddWithValue("id", id);
            retire.Parameters.AddWithValue("type", oldIds[id]);
            retire.ExecuteNonQuery();
        }

        var revision = checked(snapshot.EditRevision + 1);
        var json = JsonSerializer.Serialize(design! with { Revision = revision }, JsonOptions);
        var designId = Guid.CreateVersion7();
        using (var insert = Command(connection, transaction, """
            INSERT INTO control.building_design (id, building_id, design, revision)
            VALUES (@id, (SELECT id FROM control.building WHERE singleton_key = 1), @design::jsonb, @revision)
            """))
        {
            insert.Parameters.AddWithValue("id", designId);
            insert.Parameters.AddWithValue("design", json);
            insert.Parameters.AddWithValue("revision", revision);
            insert.ExecuteNonQuery();
        }
        using (var update = Command(connection, transaction, """
            UPDATE control.building SET saved_design_id = @id, edit_revision = @revision
            WHERE singleton_key = 1
            """))
        {
            update.Parameters.AddWithValue("id", designId);
            update.Parameters.AddWithValue("revision", revision);
            update.ExecuteNonQuery();
        }
        var updated = ReadSnapshot(connection, transaction);
        transaction.Commit();
        return Result(status, updated);
    }

    private void Initialize()
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using (var advisoryLock = Command(connection, transaction, "SELECT pg_advisory_xact_lock(1936028788, 1)"))
            advisoryLock.ExecuteNonQuery();

        if (!ScalarBool(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'control')"))
            throw new InvalidOperationException("The PostgreSQL control schema must be provisioned before Building Control starts.");

        var versionTableExists = ScalarBool(connection, transaction,
            "SELECT to_regclass('control.schema_version') IS NOT NULL");
        if (!versionTableExists)
        {
            var objectCount = ScalarLong(connection, transaction, """
                SELECT count(*) FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'control' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
                """);
            if (objectCount != 0)
                throw new InvalidOperationException("Cannot initialize an unversioned non-empty control schema.");

            using var migration = Command(connection, transaction, ReadMigration(MigrationFileName));
            migration.ExecuteNonQuery();
        }

        var version = ReadSchemaVersion(connection, transaction);
        if (version != SchemaVersion)
            throw new InvalidOperationException($"Unsupported building design schema version {version}.");
        EnsureSchemaObjects(connection, transaction);

        var stateCount = ScalarLong(connection, transaction, "SELECT count(*) FROM control.building");
        var seeded = ReadSeededState(connection, transaction);
        if (!seeded)
        {
            if (stateCount != 0)
                throw new InvalidOperationException("The control schema has design data without a completed initial seed marker.");
            if (ScalarLong(connection, transaction, "SELECT count(*) FROM control.building_design") != 0)
                throw new InvalidOperationException("The control schema has design data without a completed initial seed marker.");
            var seed = JsonSerializer.Serialize(BuildingDesignSeed.Create(), JsonOptions);
            var buildingId = Guid.CreateVersion7();
            var designId = Guid.CreateVersion7();
            using (var building = Command(connection, transaction, """
                INSERT INTO control.building (id, singleton_key, name, saved_design_id, active_design_id, edit_revision)
                VALUES (@building, 1, 'Building', @design, @design, 1)
                """))
            {
                building.Parameters.AddWithValue("building", buildingId);
                building.Parameters.AddWithValue("design", designId);
                building.ExecuteNonQuery();
            }
            using (var design = Command(connection, transaction, """
                INSERT INTO control.building_design (id, building_id, design, revision)
                VALUES (@id, @building, @seed::jsonb, 1)
                """))
            {
                design.Parameters.AddWithValue("id", designId);
                design.Parameters.AddWithValue("building", buildingId);
                design.Parameters.AddWithValue("seed", seed);
                design.ExecuteNonQuery();
            }
            using var markSeeded = Command(connection, transaction,
                "UPDATE control.schema_version SET seeded = true WHERE singleton_key = 1 AND seeded = false");
            if (markSeeded.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("The control schema initial seed marker changed unexpectedly.");
        }
        else if (stateCount != 1)
        {
            throw new InvalidOperationException("Building design database is missing its state row.");
        }

        transaction.Commit();
    }

    private static int ReadSchemaVersion(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        using var command = Command(connection, transaction,
            "SELECT version FROM control.schema_version WHERE singleton_key = 1");
        var value = command.ExecuteScalar();
        if (value is null or DBNull)
            throw new InvalidOperationException("The control schema has no supported schema version marker.");
        return (int)value;
    }

    private static bool ReadSeededState(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        using var command = Command(connection, transaction,
            "SELECT seeded FROM control.schema_version WHERE singleton_key = 1");
        var value = command.ExecuteScalar();
        if (value is null or DBNull)
            throw new InvalidOperationException("The control schema has no initial seed state.");
        return (bool)value;
    }

    private static void EnsureSchemaObjects(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        foreach (var table in new[] { "building", "building_design", "retired_design_entity_id", "controller_mqtt_retained_cleanup" })
        {
            using var command = Command(connection, transaction, "SELECT to_regclass(@name) IS NOT NULL");
            command.Parameters.AddWithValue("name", $"control.{table}");
            if (!(bool)command.ExecuteScalar()!)
                throw new InvalidOperationException($"The control schema is missing required table '{table}'.");
        }
    }

    private static string ReadMigration(string fileName)
    {
        var assembly = typeof(BuildingDesignStore).Assembly;
        var resourceName = MigrationResourcePrefix + fileName;
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Required database migration resource '{resourceName}' was not found.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static Dictionary<string, string> DesignIds(BuildingDesign design)
    {
        var ids = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var floor in design.Floors)
        {
            ids.Add(floor.Id, "floor");
            ids.Add(floor.ControllerId, "controller");
            foreach (var walkway in floor.Walkways ?? []) ids.Add(walkway.Id, "walkway");
            foreach (var stair in floor.Stairs ?? []) ids.Add(stair.Id, "stair");
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

    private NpgsqlConnection Open()
    {
        var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        return connection;
    }

    private static NpgsqlCommand Command(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        return command;
    }

    private static long ScalarLong(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql)
    {
        using var command = Command(connection, transaction, sql);
        return (long)command.ExecuteScalar()!;
    }

    private static bool ScalarBool(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql)
    {
        using var command = Command(connection, transaction, sql);
        return (bool)command.ExecuteScalar()!;
    }

    private static BuildingDesignSnapshot ReadSnapshot(
        NpgsqlConnection connection, NpgsqlTransaction transaction, bool lockForUpdate = false)
    {
        if (lockForUpdate)
        {
            // Read the joined designs in a new statement snapshot after acquiring the lock.
            using var lockBuilding = Command(connection, transaction,
                "SELECT id FROM control.building WHERE singleton_key = 1 FOR UPDATE");
            if (lockBuilding.ExecuteScalar() is null)
                throw new InvalidOperationException("Building design database is missing its state row.");
        }

        using var command = Command(connection, transaction, """
            SELECT saved.design::text, active.design::text, b.edit_revision
            FROM control.building b
            JOIN control.building_design saved ON saved.id = b.saved_design_id AND saved.building_id = b.id
            JOIN control.building_design active ON active.id = b.active_design_id AND active.building_id = b.id
            WHERE b.singleton_key = 1
            """);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw new InvalidOperationException("Building design database is missing its state row.");
        BuildingDesign Parse(int index) => JsonSerializer.Deserialize<BuildingDesign>(reader.GetString(index), JsonOptions)
            ?? throw new InvalidOperationException("Building design database contains an empty design.");
        return new(Parse(0), Parse(1), reader.GetInt64(2));
    }
}

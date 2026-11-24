using Devices.Contracts;
using Microsoft.Data.Sqlite;
using System.Text.Json;

public class BuildingDesignTests : IDisposable
{
    private readonly string path = Path.Combine(AppContext.BaseDirectory, $"building-design-test-{Guid.NewGuid():N}.db");

    [Fact]
    public void SeedPreservesExistingIdentitiesAndIsSavable()
    {
        var seed = BuildingDesignSeed.Create();
        Assert.Empty(BuildingDesignValidator.ValidateForSave(seed));
        Assert.Equal(20m, seed.Width);
        Assert.Equal(20m, seed.Depth);
        foreach (var controller in DeviceIds.CreateBuilding())
        {
            var floor = seed.Floors.Single(f => f.Number == controller.Floor);
            Assert.Equal(controller.Id, floor.ControllerId);
            foreach (var original in controller.Rooms)
            {
                var room = floor.Rooms.Single(r => r.Id == original.Id);
                Assert.Equal(original.Name, room.Name);
                Assert.Equal(original.LightStrips.Select(l => l.Id), room.Lights.Select(l => l.Id));
                var key = original.Id[$"floor-{controller.Floor}-".Length..];
                Assert.Equal(DeviceIds.Sensor(controller.Floor, key), room.Sensor.Id);
                Assert.Single(room.Doors);
            }
        }
    }

    [Fact]
    public void SaveRequiresDevicesConnectedToOwnFloor()
    {
        var seed = BuildingDesignSeed.Create();
        var room = seed.Floors[0].Rooms[0];
        var disconnected = WithRoom(seed, room with
        {
            Sensor = room.Sensor with { ControllerId = null },
            Lights = [room.Lights[0] with { ControllerId = null }]
        });
        Assert.Empty(BuildingDesignValidator.ValidateStructure(disconnected));
        Assert.Equal(2, BuildingDesignValidator.ValidateForSave(disconnected).Count);
        var foreign = WithRoom(seed, room with { Sensor = room.Sensor with { ControllerId = seed.Floors[1].ControllerId } });
        Assert.Empty(BuildingDesignValidator.ValidateStructure(foreign));
        Assert.Contains(BuildingDesignValidator.ValidateForSave(foreign), e => e.Path.EndsWith("sensor.controllerId"));
    }

    [Fact]
    public void GeometryAndShapeErrorsAreReportedWithoutThrowing()
    {
        var seed = BuildingDesignSeed.Create();
        var room = seed.Floors[0].Rooms[0];
        var invalid = WithRoom(seed, room with
        {
            Width = 12.25m,
            Sensor = null!,
            Doors = [null!],
            Lights = null!
        });
        var errors = BuildingDesignValidator.ValidateForSave(invalid);
        Assert.Contains(errors, e => e.Path.EndsWith(".sensor"));
        Assert.Contains(errors, e => e.Path.EndsWith(".doors[0]"));
        Assert.Contains(errors, e => e.Path.EndsWith(".lights"));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Width = 12.25m })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(null));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Floors = null! }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Floors = [null!] }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Width = 1 }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Depth = 100.5m }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Floors = [] }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Floors = Enumerable.Repeat(seed.Floors[0], 11).ToArray() }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(seed with { Floors = [seed.Floors[1]] }));
    }

    [Fact]
    public void GeometryChecksOverlapBoundaryGridAndIds()
    {
        var seed = BuildingDesignSeed.Create();
        var room = seed.Floors[0].Rooms[0];
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Width = 12.5m })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Doors = [new("door", room.X + 1, room.Z + 1)] })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Doors = [new("door", room.X, room.Z + 0.25m)] })));
        Assert.Empty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Doors = [new("door", room.X, room.Z + 1)] })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Sensor = room.Sensor with { X = 12.5m } })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Id = "bad/id" })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateForSave(WithRoom(seed, room with { Id = room.Sensor.Id })));
    }

    [Fact]
    public void SeedApproximatesBaselineRoomAndDoorLayouts()
    {
        var seed = BuildingDesignSeed.Create();
        var floor1 = seed.Floors[0];
        var main = floor1.Rooms.Single(r => r.Id == DeviceIds.Room(1, "main"));
        var office = floor1.Rooms.Single(r => r.Id == DeviceIds.Room(1, "office-a"));
        Assert.Equal((5.5m, 6.5m, 4.5m, 7m), (main.X, main.Z, main.Width, main.Depth));
        Assert.Equal((main.X + main.Width, 8.5m), (main.Doors[0].X, main.Doors[0].Z));
        Assert.Equal(office.Z, office.Doors[0].Z);
        var floor2Main = seed.Floors[1].Rooms[0];
        Assert.Equal(floor2Main.Z, floor2Main.Doors[0].Z);
        Assert.Equal(7m, floor2Main.Width);
        Assert.Equal(9.5m, seed.Floors[3].Rooms[0].Width);
    }

    [Fact]
    public void SavesAndActivatesAcrossRestartAndRejectsBadSave()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var changed = initial.Saved with { Width = 21 };
        var invalid = store.Save(initial.EditRevision, changed with { Width = 1 });
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, invalid.Status);
        Assert.NotEmpty(invalid.Errors);
        Assert.Equal(20, invalid.Snapshot.Saved.Width);
        var save = store.Save(initial.EditRevision, changed);
        Assert.Equal(BuildingDesignStoreStatus.Success, save.Status);
        Assert.Equal(20, save.Snapshot.Active.Width);
        Assert.Equal(21, save.Snapshot.Saved.Width);
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.ActivateSaved(initial.Saved.Revision).Status);
        var activated = store.ActivateSaved(save.Snapshot.Saved.Revision);
        Assert.Equal(21, activated.Snapshot.Active.Width);
        var restarted = new BuildingDesignStore(path).Read();
        Assert.Equal(21, restarted.Saved.Width);
        Assert.Equal(21, restarted.Active.Width);
    }

    [Fact]
    public void RevisionConflictsPreserveSavedDesign()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Width = 21 });
        Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.Save(initial.EditRevision, initial.Saved).Status);
        Assert.Equal(21, store.Read().Saved.Width);
    }

    [Fact]
    public void IncompleteDesignCannotBecomeSaved()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var room = initial.Saved.Floors[0].Rooms[0];
        var incomplete = WithRoom(initial.Saved, room with { Sensor = room.Sensor with { ControllerId = null } });
        var saved = store.Save(initial.EditRevision, incomplete);
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, saved.Status);
        var restarted = new BuildingDesignStore(path).Read();
        Assert.NotNull(restarted.Saved.Floors[0].Rooms[0].Sensor.ControllerId);
    }

    [Fact]
    public void InvalidIntermediateGeometryAndNamesCannotBeSaved()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var room = initial.Saved.Floors[0].Rooms[0];
        var invalid = WithRoom(initial.Saved, room with
        {
            Name = " ",
            X = -1,
            Width = 0.25m,
            Sensor = room.Sensor with { ControllerId = "unknown-controller" },
            Doors = [new DoorDesign("draft-door", 2, 2)]
        }) with { Width = 1 };
        Assert.Empty(BuildingDesignValidator.ValidateStructure(invalid));
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, store.Save(initial.EditRevision, invalid).Status);
        var restarted = new BuildingDesignStore(path).Read();
        Assert.Equal(20, restarted.Saved.Width);
    }

    [Fact]
    public void StructureRejectsMalformedShapesUnsafeIdsAndOversizedPayloads()
    {
        var seed = BuildingDesignSeed.Create();
        var room = seed.Floors[0].Rooms[0];
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(seed with { Floors = null! }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(WithRoom(seed, room with { Sensor = null! })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(WithRoom(seed, room with { Id = "unsafe/id" })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(WithRoom(seed, room with { Name = new string('x', 257) })));
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(seed with { Floors = Enumerable.Repeat(seed.Floors[0], 101).ToArray() }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(WithRoom(seed, room with
        {
            Lights = Enumerable.Range(0, 10001).Select(i => new LightDesign($"draft-{i}", 0, 0, null)).ToArray()
        })));
    }

    [Fact]
    public async Task ConcurrentEditorsAndWritesAreSerialized()
    {
        var a = new BuildingDesignStore(path);
        var b = new BuildingDesignStore(path);
        var snapshot = a.Read();
        using var start = new Barrier(2);
        var results = await Task.WhenAll(
            Task.Run(() => { start.SignalAndWait(); return a.Save(snapshot.EditRevision, snapshot.Saved with { Width = 21 }); }),
            Task.Run(() => { start.SignalAndWait(); return b.Save(snapshot.EditRevision, snapshot.Saved with { Width = 22 }); }));
        Assert.Single(results, r => r.Status == BuildingDesignStoreStatus.Success);
        Assert.Single(results, r => r.Status == BuildingDesignStoreStatus.RevisionConflict);
        Assert.Equal(results.Single(r => r.Status == BuildingDesignStoreStatus.Success).Snapshot.Saved.Width, a.Read().Saved.Width);
        Assert.Equal(snapshot.EditRevision + 1, a.Read().EditRevision);
    }

    [Fact]
    public async Task SupersededActivationCannotOverwriteNewerSave()
    {
        var first = new BuildingDesignStore(path);
        var second = new BuildingDesignStore(path);
        var initial = first.Read();
        var old = first.Save(initial.EditRevision, initial.Saved with { Width = 21 });
        var newer = second.Save(old.Snapshot.EditRevision, old.Snapshot.Saved with { Width = 22 });

        var results = await Task.WhenAll(
            Task.Run(() => first.ActivateSaved(old.Snapshot.Saved.Revision)),
            Task.Run(() => second.ActivateSaved(newer.Snapshot.Saved.Revision)));

        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, results[0].Status);
        Assert.Equal(BuildingDesignStoreStatus.Success, results[1].Status);
        var current = first.Read();
        Assert.Equal(22, current.Saved.Width);
        Assert.Equal(current.Saved.Revision, current.Active.Revision);
        Assert.Equal(22, current.Active.Width);
    }

    [Fact]
    public void RejectsUnknownAndNonemptyUnversionedSchemas()
    {
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "CREATE TABLE unrelated (id INTEGER)";
            command.ExecuteNonQuery();
        }
        Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA user_version = 5";
            command.ExecuteNonQuery();
        }
        Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
    }

    [Fact]
    public void VersionOneDatabaseIsMigratedWithoutReseeding()
    {
        var active = BuildingDesignSeed.Create();
        var old = active with { Revision = 7, Width = 25, Floors = active.Floors.Take(3).ToArray() };
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE building_design (
                    id INTEGER PRIMARY KEY, saved TEXT NOT NULL, active TEXT NOT NULL, draft TEXT,
                    edit_revision INTEGER NOT NULL, lease_token TEXT, lease_expiry INTEGER
                );
                INSERT INTO building_design (id, saved, active, draft, edit_revision) VALUES (1, $design, $active, $draft, 7);
                PRAGMA user_version = 1;
                """;
            command.Parameters.AddWithValue("$design", JsonSerializer.Serialize(old, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            command.Parameters.AddWithValue("$active", JsonSerializer.Serialize(active, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            command.Parameters.AddWithValue("$draft", JsonSerializer.Serialize(active with { Width = 30 }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            command.ExecuteNonQuery();
        }
        var store = new BuildingDesignStore(path);
        Assert.Equal(25, store.Read().Saved.Width);
        Assert.Equal(20, store.Read().Active.Width);
        Assert.Equal(4, store.Read().Active.Floors.Count);
        Assert.Equal(7, store.Read().EditRevision);
        Assert.Empty(store.ReadCleanup());
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT count(*) FROM pragma_table_info('building_design') WHERE name = 'draft'";
            Assert.Equal(0L, (long)command.ExecuteScalar()!);
        }
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, store.Save(7, active).Status);
        Assert.Equal(BuildingDesignStoreStatus.Success, store.Save(7, old).Status);
    }

    [Fact]
    public void VersionTwoMigrationDiscardsDraftAndPreservesSavedActiveAndRevision()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Width = 21 });
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                ALTER TABLE building_design ADD COLUMN draft TEXT;
                ALTER TABLE building_design ADD COLUMN lease_token TEXT;
                ALTER TABLE building_design ADD COLUMN lease_expiry INTEGER;
                UPDATE building_design SET draft = $draft WHERE id = 1;
                PRAGMA user_version = 2;
                """;
            command.Parameters.AddWithValue("$draft", JsonSerializer.Serialize(initial.Saved with { Width = 30 }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            command.ExecuteNonQuery();
        }

        var migrated = new BuildingDesignStore(path);
        Assert.Equal(21, migrated.Read().Saved.Width);
        Assert.Equal(20, migrated.Read().Active.Width);
        Assert.Equal(saved.Snapshot.EditRevision, migrated.Read().EditRevision);
        Assert.Equal(BuildingDesignStoreStatus.Success, migrated.Save(saved.Snapshot.EditRevision, saved.Snapshot.Saved).Status);
        using var check = new SqliteConnection($"Data Source={path};Pooling=False");
        check.Open();
        using var query = check.CreateCommand();
        query.CommandText = "SELECT count(*) FROM pragma_table_info('building_design') WHERE name = 'draft'";
        Assert.Equal(0L, (long)query.ExecuteScalar()!);
    }

    [Fact]
    public void VersionThreeMigrationRemovesLeaseAndPreservesAllDurableState()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var reduced = initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() };
        var removed = store.Save(initial.EditRevision, reduced);
        store.ActivateSaved(removed.Snapshot.Saved.Revision);
        var cleanup = Assert.Single(store.ReadCleanup());
        Assert.Equal(BuildingDesignStoreStatus.Success, store.MarkCleanupFailed(cleanup.ControllerId, cleanup.ActiveRevision));
        var pending = store.Save(removed.Snapshot.EditRevision, reduced with { Width = 25 });
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                ALTER TABLE building_design ADD COLUMN lease_token TEXT;
                ALTER TABLE building_design ADD COLUMN lease_expiry INTEGER;
                UPDATE building_design SET lease_token = 'old-token', lease_expiry = 9999999999999;
                PRAGMA user_version = 3;
                """;
            command.ExecuteNonQuery();
        }

        var migrated = new BuildingDesignStore(path);
        var snapshot = migrated.Read();
        Assert.Equal(pending.Snapshot.EditRevision, snapshot.EditRevision);
        Assert.Equal(25, snapshot.Saved.Width);
        Assert.Equal(20, snapshot.Active.Width);
        Assert.Equal(removed.Snapshot.Saved.Revision, snapshot.Active.Revision);
        var preservedCleanup = Assert.Single(migrated.ReadCleanup());
        Assert.Equal(cleanup.ControllerId, preservedCleanup.ControllerId);
        Assert.Equal(cleanup.ActiveRevision, preservedCleanup.ActiveRevision);
        Assert.Equal(BuildingDesignCleanupStatus.Failed, preservedCleanup.Status);
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, migrated.Save(snapshot.EditRevision, initial.Saved).Status);
        Assert.Equal(BuildingDesignStoreStatus.Success, migrated.ActivateSaved(snapshot.Saved.Revision).Status);

        using var check = new SqliteConnection($"Data Source={path};Pooling=False");
        check.Open();
        using var query = check.CreateCommand();
        query.CommandText = "SELECT count(*) FROM pragma_table_info('building_design') WHERE name IN ('lease_token', 'lease_expiry')";
        Assert.Equal(0L, (long)query.ExecuteScalar()!);
        query.CommandText = "PRAGMA user_version";
        Assert.Equal(4L, (long)query.ExecuteScalar()!);
    }

    [Fact]
    public void ControllerCleanupIsDurableAndFencedByActivationRevision()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var removed = initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() };
        var saved = store.Save(initial.EditRevision, removed);
        Assert.Empty(store.ReadCleanup());
        var firstActivation = store.ActivateSaved(saved.Snapshot.Saved.Revision);
        var item = Assert.Single(new BuildingDesignStore(path).ReadCleanup());
        Assert.Equal(DeviceIds.Controller(4), item.ControllerId);
        Assert.Equal(BuildingDesignCleanupStatus.Pending, item.Status);
        Assert.Equal(firstActivation.Snapshot.Active.Revision, item.ActiveRevision);
        Assert.Equal(BuildingDesignStoreStatus.Success, store.MarkCleanupFailed(item.ControllerId, item.ActiveRevision));
        Assert.Equal(BuildingDesignCleanupStatus.Failed, Assert.Single(new BuildingDesignStore(path).ReadCleanup()).Status);
        var next = store.Save(saved.Snapshot.EditRevision, removed with { Width = 21 });
        Assert.Equal(BuildingDesignStoreStatus.Success, store.ActivateSaved(next.Snapshot.Saved.Revision).Status);
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.MarkCleanupFailed(item.ControllerId, item.ActiveRevision));
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.CompleteCleanup(item.ControllerId, item.ActiveRevision));
        item = Assert.Single(store.ReadCleanup());
        Assert.Equal(next.Snapshot.Saved.Revision, item.ActiveRevision);
        Assert.Equal(BuildingDesignCleanupStatus.Failed, item.Status);
        Assert.Equal(BuildingDesignStoreStatus.Success, store.CompleteCleanup(item.ControllerId, item.ActiveRevision));
        Assert.Equal(BuildingDesignStoreStatus.Success, store.CompleteCleanup(item.ControllerId, item.ActiveRevision));
        Assert.Equal(BuildingDesignCleanupStatus.Completed, Assert.Single(store.ReadCleanup()).Status);
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.CancelCleanup(item.ControllerId, item.ActiveRevision));
    }

    [Fact]
    public void DeletedIdsCannotBeReusedAfterRestartOrChangeEntityType()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var removed = initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() };
        var saved = store.Save(initial.EditRevision, removed);
        var restarted = new BuildingDesignStore(path);
        var reuse = restarted.Save(saved.Snapshot.EditRevision, initial.Saved);
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, reuse.Status);
        Assert.Contains(reuse.Errors, e => e.Message.Contains("retired"));
        Assert.Equal(3, restarted.Read().Saved.Floors.Count);
        var room = removed.Floors[0].Rooms[0];
        var swapped = WithRoom(removed, room with
        {
            Id = room.Sensor.Id,
            Sensor = room.Sensor with { Id = room.Id }
        });
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, restarted.Save(saved.Snapshot.EditRevision, swapped).Status);
    }

    [Fact]
    public void CleanupCanBeCancelledOnlyAgainstTheCurrentActiveRevision()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        store.ActivateSaved(saved.Snapshot.Saved.Revision);
        var item = Assert.Single(store.ReadCleanup());
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.CancelCleanup(item.ControllerId, item.ActiveRevision - 1));
        Assert.Equal(BuildingDesignStoreStatus.Success, store.CancelCleanup(item.ControllerId, item.ActiveRevision));
        Assert.Equal(BuildingDesignStoreStatus.Success, store.CancelCleanup(item.ControllerId, item.ActiveRevision));
        Assert.Equal(BuildingDesignCleanupStatus.Cancelled, Assert.Single(store.ReadCleanup()).Status);
    }

    [Fact]
    public void DatabaseFailureRollsBackRetirementsAndDesignWrite()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TRIGGER reject_save BEFORE UPDATE OF saved ON building_design
                BEGIN SELECT RAISE(ABORT, 'simulated failure'); END
                """;
            command.ExecuteNonQuery();
        }
        var removed = initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() };
        Assert.Throws<SqliteException>(() => store.Save(initial.EditRevision, removed));
        var unchanged = store.Read();
        Assert.Equal(initial.EditRevision, unchanged.EditRevision);
        Assert.Equal(4, unchanged.Saved.Floors.Count);
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "DROP TRIGGER reject_save; SELECT count(*) FROM retired_design_id";
            Assert.Equal(0L, (long)command.ExecuteScalar()!);
        }
        Assert.Equal(BuildingDesignStoreStatus.Success, store.Save(initial.EditRevision, initial.Saved).Status);
    }

    [Fact]
    public void FailedActivationDoesNotEnqueueCleanup()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TRIGGER reject_activation BEFORE UPDATE OF active ON building_design
                BEGIN SELECT RAISE(ABORT, 'simulated failure'); END
                """;
            command.ExecuteNonQuery();
        }
        Assert.Throws<SqliteException>(() => store.ActivateSaved(saved.Snapshot.Saved.Revision));
        Assert.Empty(store.ReadCleanup());
        Assert.Equal(4, store.Read().Active.Floors.Count);
        Assert.Equal(3, store.Read().Saved.Floors.Count);
    }

    [Fact]
    public void ActivationRejectsStaleSavedRevision()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        store = new BuildingDesignStore(path);

        var stale = store.ActivateSaved(initial.Saved.Revision);
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, stale.Status);
        Assert.Equal(4, store.Read().Active.Floors.Count);
        Assert.Empty(store.ReadCleanup());

        var recovered = store.ActivateSaved(saved.Snapshot.Saved.Revision);
        Assert.Equal(BuildingDesignStoreStatus.Success, recovered.Status);
        Assert.Equal(saved.Snapshot.Saved.Revision, recovered.Snapshot.Active.Revision);
        var cleanup = Assert.Single(new BuildingDesignStore(path).ReadCleanup());
        Assert.Equal(DeviceIds.Controller(4), cleanup.ControllerId);
        Assert.Equal(recovered.Snapshot.Active.Revision, cleanup.ActiveRevision);
    }

    private static BuildingDesign WithRoom(BuildingDesign design, RoomDesign room)
    {
        var floor = design.Floors[0];
        return design with { Floors = [floor with { Rooms = [room, .. floor.Rooms.Skip(1)] }, .. design.Floors.Skip(1)] };
    }

    public void Dispose()
    {
        foreach (var suffix in new[] { "", "-journal", "-wal", "-shm" })
            if (File.Exists(path + suffix)) File.Delete(path + suffix);
    }

}

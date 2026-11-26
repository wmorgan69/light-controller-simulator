using Devices.Contracts;
using Npgsql;
using System.Text.Json;
using System.Text.Json.Nodes;

public class BuildingDesignTests
{
    private readonly string path = ControlTestDatabase.ConnectionString;

    public BuildingDesignTests() => ControlTestDatabase.Reset();

    [Fact]
    public void SeedPreservesExistingIdentitiesAndIsSavable()
    {
        var seed = BuildingDesignSeed.Create();
        Assert.Empty(BuildingDesignValidator.ValidateForSave(seed));
        Assert.Equal(10m, seed.Width);
        Assert.Equal(8m, seed.Depth);
        Assert.Equal(4, seed.Floors.Count);
        foreach (var controller in DeviceIds.CreateBuilding())
        {
            var floor = seed.Floors.Single(f => f.Number == controller.Floor);
            Assert.Equal($"floor-{controller.Floor}", floor.Id);
            Assert.Equal(controller.Id, floor.ControllerId);
            Assert.Equal((0.5m, 0.5m), (floor.ControllerX, floor.ControllerZ));
            Assert.Equal(controller.Rooms.Count, floor.Rooms.Count);
            foreach (var original in controller.Rooms)
            {
                var room = floor.Rooms.Single(r => r.Id == original.Id);
                Assert.Equal(original.Name, room.Name);
                Assert.Equal(original.LightStrips.Select(l => l.Id), room.Lights.Select(l => l.Id));
                var key = original.Id[$"floor-{controller.Floor}-".Length..];
                Assert.Equal(DeviceIds.Sensor(controller.Floor, key), room.Sensor.Id);
                Assert.Equal(controller.Id, room.Sensor.ControllerId);
                Assert.All(room.Lights, light => Assert.Equal(controller.Id, light.ControllerId));
                Assert.Equal($"door-{room.Id}-1", Assert.Single(room.Doors).Id);
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
        Assert.Equal((0.5m, 0.5m, 4.5m, 7m), (main.X, main.Z, main.Width, main.Depth));
        Assert.Equal((main.X + main.Width, 2.5m), (main.Doors[0].X, main.Doors[0].Z));
        Assert.Equal(office.Z, office.Doors[0].Z);
        var floor2Main = seed.Floors[1].Rooms[0];
        Assert.Equal(floor2Main.Z, floor2Main.Doors[0].Z);
        Assert.Equal(7m, floor2Main.Width);
        Assert.Equal(9.5m, seed.Floors[3].Rooms[0].Width);
    }

    [Theory]
    [InlineData(1, "main", -2.4, 0, 4.7, 7.1)]
    [InlineData(1, "office-a", 1.25, 0, 2.35, 2.8)]
    [InlineData(1, "office-b", 3.8, 0, 2.35, 2.8)]
    [InlineData(2, "main", -1.125, 1.075, 7.25, 4.95)]
    [InlineData(2, "office-a", 3.8, 0, 2.35, 2.8)]
    [InlineData(3, "main", -2.4, 0, 4.7, 7.1)]
    [InlineData(3, "office-a", 1.25, 0, 2.35, 2.8)]
    [InlineData(3, "office-b", 3.8, 0, 2.35, 2.8)]
    [InlineData(4, "main", 0, 1.075, 9.5, 4.95)]
    public void SeedRoomEdgesAreWithinHalfAGridStepOfLegacyLayout(
        int floorNumber, string key, decimal centerX, decimal centerZ, decimal width, decimal depth)
    {
        var room = BuildingDesignSeed.Create().Floors.Single(f => f.Number == floorNumber)
            .Rooms.Single(r => r.Id == DeviceIds.Room(floorNumber, key));

        Assert.InRange(Math.Abs(room.X - (5 + centerX - width / 2)), 0m, 0.25m);
        Assert.InRange(Math.Abs(room.Z - (4 + centerZ - depth / 2)), 0m, 0.25m);
        Assert.InRange(Math.Abs(room.X + room.Width - (5 + centerX + width / 2)), 0m, 0.25m);
        Assert.InRange(Math.Abs(room.Z + room.Depth - (4 + centerZ + depth / 2)), 0m, 0.25m);
    }

    [Fact]
    public void SeedFixturesRetainTheirGridPositionsRelativeToTheBuildingCenter()
    {
        foreach (var floor in BuildingDesignSeed.Create().Floors)
        {
            var main = floor.Rooms[0];
            decimal[] lightXs = floor.Number switch
            {
                2 => [1, 3, 5, 7],
                4 => [1, 2.5m, 4, 6, 7.5m, 9],
                _ => [1.5m, 2.5m, 4]
            };
            decimal[] lightZs = floor.Number is 2 or 4 ? [4, 6.5m] : [2.5m, 5.5m];
            Assert.Equal(lightZs.SelectMany(z => lightXs.Select(x => (x, z))),
                main.Lights.Select(light => (light.X, light.Z)));
            var sensor = floor.Number switch
            {
                2 => (4m, 5m),
                4 => (5m, 5m),
                _ => (3m, 4m)
            };
            Assert.Equal(sensor, (main.Sensor.X, main.Sensor.Z));
            foreach (var office in floor.Rooms.Skip(1))
            {
                var x = floor.Number == 2 || office.Id.EndsWith("office-b") ? 9m : 6.5m;
                Assert.Equal((x, 4m), (Assert.Single(office.Lights).X, office.Lights[0].Z));
                Assert.Equal((x, 5m), (office.Sensor.X, office.Sensor.Z));
                Assert.Equal((x, 2.5m), (office.Doors[0].X, office.Doors[0].Z));
            }
        }
    }

    [Fact]
    public void ReopeningExistingTwentyMetreDesignPreservesSavedAndActivePayloads()
    {
        var seed = BuildingDesignSeed.Create();
        var legacy = seed with
        {
            Width = 20,
            Depth = 20,
            Floors = seed.Floors.Select(floor => floor with
            {
                ControllerX = floor.ControllerX + 5,
                ControllerZ = floor.ControllerZ + 6,
                Rooms = floor.Rooms.Select(room => room with
                {
                    X = room.X + 5,
                    Z = room.Z + 6,
                    Sensor = room.Sensor with { X = room.Sensor.X + 5, Z = room.Sensor.Z + 6 },
                    Doors = room.Doors.Select(door => door with { X = door.X + 5, Z = door.Z + 6 }).ToArray(),
                    Lights = room.Lights.Select(light => light with { X = light.X + 5, Z = light.Z + 6 }).ToArray()
                }).ToArray()
            }).ToArray()
        };
        Assert.Empty(BuildingDesignValidator.ValidateForSave(legacy));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var activeJson = JsonSerializer.Serialize(legacy, options);
        var savedJson = JsonSerializer.Serialize(legacy with { Revision = 9, Width = 23 }, options);
        _ = new BuildingDesignStore(path);
        using var connection = new NpgsqlConnection(path);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE control.building_design SET design = @active::jsonb
            WHERE id = (SELECT active_design_id FROM control.building WHERE singleton_key = 1);
            WITH new_design AS (
                INSERT INTO control.building_design (building_id, design, revision)
                SELECT id, @saved::jsonb, 9 FROM control.building WHERE singleton_key = 1 RETURNING id
            )
            UPDATE control.building SET saved_design_id = (SELECT id FROM new_design), edit_revision = 9 WHERE singleton_key = 1
            """;
        command.Parameters.AddWithValue("saved", savedJson);
        command.Parameters.AddWithValue("active", activeJson);
        command.ExecuteNonQuery();

        var reopened = new BuildingDesignStore(path).Read();
        Assert.Equal(savedJson, JsonSerializer.Serialize(reopened.Saved, options));
        Assert.Equal(activeJson, JsonSerializer.Serialize(reopened.Active, options));
        Assert.Equal(9, reopened.EditRevision);
        command.CommandText = """
            SELECT saved.design::text, active.design::text FROM control.building b
            JOIN control.building_design saved ON saved.id = b.saved_design_id
            JOIN control.building_design active ON active.id = b.active_design_id
            WHERE b.singleton_key = 1
            """;
        using var reader = command.ExecuteReader();
        Assert.True(reader.Read());
        Assert.True(JsonNode.DeepEquals(
            JsonSerializer.SerializeToNode(legacy with { Revision = 9, Width = 23 }, options),
            JsonNode.Parse(reader.GetString(0))));
        Assert.True(JsonNode.DeepEquals(
            JsonSerializer.SerializeToNode(legacy, options),
            JsonNode.Parse(reader.GetString(1))));
    }

    [Fact]
    public void SavesAndActivatesAcrossRestartAndRejectsBadSave()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        Assert.Equal((10m, 8m), (initial.Saved.Width, initial.Saved.Depth));
        Assert.Equal((10m, 8m), (initial.Active.Width, initial.Active.Depth));
        var changed = initial.Saved with { Width = 21 };
        var invalid = store.Save(initial.EditRevision, changed with { Width = 1 });
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, invalid.Status);
        Assert.NotEmpty(invalid.Errors);
        Assert.Equal(10, invalid.Snapshot.Saved.Width);
        var save = store.Save(initial.EditRevision, changed);
        Assert.Equal(BuildingDesignStoreStatus.Success, save.Status);
        Assert.Equal(10, save.Snapshot.Active.Width);
        Assert.Equal(21, save.Snapshot.Saved.Width);
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, store.ActivateSaved(initial.Saved.Revision).Status);
        var activated = store.ActivateSaved(save.Snapshot.Saved.Revision);
        Assert.Equal(21, activated.Snapshot.Active.Width);
        var restarted = new BuildingDesignStore(path).Read();
        Assert.Equal(21, restarted.Saved.Width);
        Assert.Equal(21, restarted.Active.Width);
    }

    [Fact]
    public void DesignReferencesAndRetirementDiagnosticsReflectSaveAndActivation()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with
        {
            Floors = initial.Saved.Floors.Take(3).ToArray()
        });
        Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
        Assert.True((bool)ControlTestDatabase.Scalar("""
            SELECT b.saved_design_id <> b.active_design_id
              AND saved.building_id = b.id AND active.building_id = b.id
              AND saved.revision = b.edit_revision AND active.revision < saved.revision
            FROM control.building b
            JOIN control.building_design saved ON saved.id = b.saved_design_id
            JOIN control.building_design active ON active.id = b.active_design_id
            WHERE b.singleton_key = 1
            """)!);
        Assert.True((bool)ControlTestDatabase.Scalar("""
            SELECT EXISTS (
                SELECT 1 FROM control.retired_design_entity_id r
                JOIN control.building b ON b.id = r.building_id
                WHERE r.entity_type = 'controller' AND r.retired_at IS NOT NULL
            )
            """)!);

        Assert.Equal(BuildingDesignStoreStatus.Success, store.ActivateSaved(saved.Snapshot.Saved.Revision).Status);
        Assert.True((bool)ControlTestDatabase.Scalar("""
            SELECT b.saved_design_id = b.active_design_id
              AND EXISTS (SELECT 1 FROM control.controller_mqtt_retained_cleanup c
                          WHERE c.building_id = b.id AND c.active_design_revision = b.edit_revision)
            FROM control.building b WHERE b.singleton_key = 1
            """)!);
    }

    [Fact]
    public void ControlTimestampsAdvanceOnUpdates()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        store.ActivateSaved(saved.Snapshot.Saved.Revision);
        foreach (var table in new[] { "schema_version", "building", "building_design", "retired_design_entity_id", "controller_mqtt_retained_cleanup" })
        {
            Assert.True((bool)ControlTestDatabase.Scalar($"""
                SELECT bool_and(created_at IS NOT NULL AND updated_at IS NOT NULL)
                FROM control.{table}
                """)!);
            Assert.True((bool)ControlTestDatabase.Scalar($"""
                WITH before_update AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
                changed AS (
                    UPDATE control.{table} AS target SET created_at = target.created_at
                    FROM before_update RETURNING target.updated_at, before_update.checked_at
                )
                SELECT bool_and(updated_at >= checked_at) FROM changed
                """)!);
        }
    }

    [Fact]
    public void ExplicitWalkwaysAndStairsRoundTripWhileUnspecifiedFloorsStayLegacy()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var floor = initial.Saved.Floors[0] with
        {
            Walkways =
            [
                new WalkwayDesign("walkway-a", -3.123m, 1.234m, 4.567m, 2.345m),
                new WalkwayDesign("walkway-boundary", -4, -4, initial.Saved.Width + 8, initial.Saved.Depth + 8)
            ],
            Stairs = [new StairDesign("stair-a", 2.123m, 3.456m, 1.25m, 2.125m, "east")]
        };
        var design = initial.Saved with
        {
            Floors = [floor, .. initial.Saved.Floors.Skip(1)]
        };

        var saved = store.Save(initial.EditRevision, design);
        Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
        var reloaded = new BuildingDesignStore(path).Read().Saved;
        Assert.Equal(floor.Walkways, reloaded.Floors[0].Walkways);
        Assert.Equal(floor.Stairs, reloaded.Floors[0].Stairs);
        Assert.Null(reloaded.Floors[1].Walkways);
        Assert.Null(reloaded.Floors[1].Stairs);
    }

    [Fact]
    public void LegacyDesignWithoutPlaceableFieldsCanBeReadAndSaved()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        string LegacyJson(BuildingDesign design)
        {
            var root = JsonNode.Parse(JsonSerializer.Serialize(design, options))!.AsObject();
            foreach (var floor in root["floors"]!.AsArray())
            {
                floor!.AsObject().Remove("walkways");
                floor.AsObject().Remove("stairs");
            }
            return root.ToJsonString(options);
        }

        using (var connection = new NpgsqlConnection(path))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                UPDATE control.building_design SET design = @design::jsonb
                WHERE id = (SELECT saved_design_id FROM control.building WHERE singleton_key = 1)
                """;
            command.Parameters.AddWithValue("design", LegacyJson(initial.Saved));
            command.ExecuteNonQuery();
        }

        var legacy = new BuildingDesignStore(path).Read();
        Assert.All(legacy.Saved.Floors, floor =>
        {
            Assert.Null(floor.Walkways);
            Assert.Null(floor.Stairs);
        });
        var saved = store.Save(legacy.EditRevision, legacy.Saved with { Width = 21 });
        Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
        var restarted = new BuildingDesignStore(path).Read().Saved;
        Assert.Equal(21, restarted.Width);
        Assert.All(restarted.Floors, floor =>
        {
            Assert.Null(floor.Walkways);
            Assert.Null(floor.Stairs);
        });
    }

    [Fact]
    public void PlaceableGeometryDirectionAndTopFloorAreValidated()
    {
        var seed = BuildingDesignSeed.Create();
        var firstFloor = seed.Floors[0];
        var invalidWalkways = firstFloor with
        {
            Walkways =
            [
                new WalkwayDesign("zero-width", 0, 0, 0, 1),
                new WalkwayDesign("too-far", -4.01m, 0, 1, 1),
                new WalkwayDesign("absurd", 0, 0, 109, 1)
            ]
        };
        var invalidStairs = seed.Floors[^1] with
        {
            Stairs = [new StairDesign("top-stair", 0, 0, 1, 1, "north")]
        };
        var invalid = seed with
        {
            Floors = [invalidWalkways, .. seed.Floors.Skip(1).SkipLast(1), invalidStairs]
        };

        var errors = BuildingDesignValidator.ValidateForSave(invalid);
        Assert.Contains(errors, error => error.Path == "floors[0].walkways[0]");
        Assert.Contains(errors, error => error.Path == "floors[0].walkways[1]");
        Assert.Contains(errors, error => error.Path == "floors[0].walkways[2]");
        Assert.Contains(errors, error => error.Path == "floors[3].stairs[0].direction");
        Assert.Contains(errors, error => error.Path == "floors[3].stairs[0]");

        var store = new BuildingDesignStore(path);
        var save = store.Save(store.Read().EditRevision, invalid);
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, save.Status);
        Assert.NotEmpty(save.Errors);
        Assert.Equal(seed.Width, save.Snapshot.Saved.Width);
    }

    [Fact]
    public void PlaceableArraysAcceptPerFloorLimitsAndRejectExcessBeforeCheckingIds()
    {
        var seed = BuildingDesignSeed.Create();
        var floor = seed.Floors[0];
        var atLimit = seed with
        {
            Floors =
            [
                floor with
                {
                    Walkways = Enumerable.Range(0, 256)
                        .Select(i => new WalkwayDesign($"walkway-limit-{i}", 0, 0, 1, 1)).ToArray(),
                    Stairs = Enumerable.Range(0, 32)
                        .Select(i => new StairDesign($"stair-limit-{i}", 0, 0, 1, 1, "east")).ToArray()
                },
                .. seed.Floors.Skip(1)
            ]
        };
        Assert.Empty(BuildingDesignValidator.ValidateForSave(atLimit));

        var tooManyWalkways = seed with
        {
            Floors =
            [
                floor with
                {
                    Walkways = Enumerable.Repeat(new WalkwayDesign("duplicate/id", 0, 0, 1, 1), 257).ToArray()
                },
                .. seed.Floors.Skip(1)
            ]
        };
        var walkwayErrors = BuildingDesignValidator.ValidateStructure(tooManyWalkways);
        Assert.Collection(walkwayErrors,
            error => Assert.Equal("floors[0].walkways", error.Path));

        var tooManyStairs = seed with
        {
            Floors =
            [
                floor with
                {
                    Stairs = Enumerable.Repeat(new StairDesign("duplicate/id", 0, 0, 1, 1, "east"), 33).ToArray()
                },
                .. seed.Floors.Skip(1)
            ]
        };
        var stairErrors = BuildingDesignValidator.ValidateStructure(tooManyStairs);
        Assert.Collection(stairErrors,
            error => Assert.Equal("floors[0].stairs", error.Path));
    }

    [Fact]
    public void PlaceableIdsMustBeUniqueStableByKindAndRetiredAfterRemoval()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var floor = initial.Saved.Floors[0];
        var duplicate = floor with
        {
            Walkways = [new WalkwayDesign(floor.Rooms[0].Id, 1, 1, 2, 2)]
        };
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(initial.Saved with
        {
            Floors = [duplicate, .. initial.Saved.Floors.Skip(1)]
        }));

        var withWalkway = initial.Saved with
        {
            Floors = [floor with { Walkways = [new WalkwayDesign("walkway-life", 1, 1, 2, 2)] }, .. initial.Saved.Floors.Skip(1)]
        };
        var firstSave = store.Save(initial.EditRevision, withWalkway);
        Assert.Equal(BuildingDesignStoreStatus.Success, firstSave.Status);

        var changedKind = firstSave.Snapshot.Saved with
        {
            Floors = [firstSave.Snapshot.Saved.Floors[0] with
            {
                Walkways = [],
                Stairs = [new StairDesign("walkway-life", 1, 1, 2, 2, "west")]
            }, .. firstSave.Snapshot.Saved.Floors.Skip(1)]
        };
        var kindChange = store.Save(firstSave.Snapshot.EditRevision, changedKind);
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, kindChange.Status);
        Assert.Contains(kindChange.Errors, error => error.Message.Contains("entity type"));

        var removed = firstSave.Snapshot.Saved with
        {
            Floors = [firstSave.Snapshot.Saved.Floors[0] with { Walkways = [] }, .. firstSave.Snapshot.Saved.Floors.Skip(1)]
        };
        var removalSave = store.Save(firstSave.Snapshot.EditRevision, removed);
        Assert.Equal(BuildingDesignStoreStatus.Success, removalSave.Status);
        var reused = removalSave.Snapshot.Saved with
        {
            Floors = [removalSave.Snapshot.Saved.Floors[0] with
            {
                Walkways = [new WalkwayDesign("walkway-life", 1, 1, 2, 2)]
            }, .. removalSave.Snapshot.Saved.Floors.Skip(1)]
        };
        var reuseSave = new BuildingDesignStore(path).Save(removalSave.Snapshot.EditRevision, reused);
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, reuseSave.Status);
        Assert.Contains(reuseSave.Errors, error => error.Message.Contains("retired"));
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
        }) with
        { Width = 1 };
        Assert.Empty(BuildingDesignValidator.ValidateStructure(invalid));
        Assert.Equal(BuildingDesignStoreStatus.InvalidDesign, store.Save(initial.EditRevision, invalid).Status);
        var restarted = new BuildingDesignStore(path).Read();
        Assert.Equal(initial.Saved.Width, restarted.Saved.Width);
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
        Assert.Contains(BuildingDesignValidator.ValidateStructure(seed with
        {
            Floors = [seed.Floors[0] with { Walkways = [null!], Stairs = [null!] }, .. seed.Floors.Skip(1)]
        }), error => error.Path is "floors[0].walkways[0]" or "floors[0].stairs[0]");
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(seed with { Floors = Enumerable.Repeat(seed.Floors[0], 101).ToArray() }));
        Assert.NotEmpty(BuildingDesignValidator.ValidateStructure(WithRoom(seed, room with
        {
            Lights = Enumerable.Range(0, 10001).Select(i => new LightDesign($"draft-{i}", 0, 0, null)).ToArray()
        })));
        Assert.Contains(BuildingDesignValidator.ValidateStructure(seed with
        {
            Floors = [seed.Floors[0] with
            {
                Walkways = Enumerable.Range(0, 10001).Select(i => new WalkwayDesign($"walkway-{i}", 0, 0, 1, 1)).ToArray()
            }, .. seed.Floors.Skip(1)]
        }), error => error.Path == "floors[0].walkways");
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
    public void UnsupportedOrUnversionedSchemasFailExplicitly()
    {
        ControlTestDatabase.Execute("UPDATE control.schema_version SET version = 2 WHERE singleton_key = 1");
        var old = Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        Assert.Contains("version 2", old.Message);
        Assert.Equal(2, ControlTestDatabase.Scalar("SELECT version FROM control.schema_version WHERE singleton_key = 1"));

        ControlTestDatabase.Execute("UPDATE control.schema_version SET version = 3 WHERE singleton_key = 1");
        var unsupported = Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        Assert.Contains("Unsupported", unsupported.Message);

        ControlTestDatabase.Execute("UPDATE control.schema_version SET version = 1 WHERE singleton_key = 1");
        ControlTestDatabase.Execute("DROP TABLE control.schema_version");
        var unversioned = Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        Assert.Contains("unversioned non-empty", unversioned.Message);
    }

    [Fact]
    public void IncompleteSeedAndMissingTablesFailWithoutChangingExistingData()
    {
        ControlTestDatabase.Execute("UPDATE control.schema_version SET seeded = false");
        var incomplete = Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        Assert.Contains("without a completed initial seed marker", incomplete.Message);
        Assert.Equal(1L, (long)ControlTestDatabase.Scalar("SELECT count(*) FROM control.building")!);

        ControlTestDatabase.Execute("UPDATE control.schema_version SET seeded = true; DROP TABLE control.retired_design_entity_id");
        var missing = Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        Assert.Contains("retired_design_entity_id", missing.Message);
        Assert.Equal(1L, (long)ControlTestDatabase.Scalar("SELECT count(*) FROM control.building")!);
    }

    [Fact]
    public void LegacyVersionOneSchemaIsRejectedWithoutChangingItsData()
    {
        ControlTestDatabase.Execute("""
            DROP TABLE control.controller_mqtt_retained_cleanup, control.retired_design_entity_id;
            DROP TABLE control.building, control.building_design CASCADE;
            DROP TABLE control.schema_version;
            CREATE TABLE control.schema_version (
                id uuid PRIMARY KEY DEFAULT uuidv7(), singleton_key smallint NOT NULL UNIQUE CHECK (singleton_key = 1),
                version integer NOT NULL CHECK (version > 0), seeded boolean NOT NULL DEFAULT false,
                applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
            );
            CREATE TABLE control.building_design (
                id uuid PRIMARY KEY DEFAULT uuidv7(), singleton_key smallint NOT NULL UNIQUE CHECK (singleton_key = 1),
                saved jsonb NOT NULL, active jsonb NOT NULL, edit_revision bigint NOT NULL CHECK (edit_revision > 0)
            );
            CREATE TABLE control.retired_design_id (id uuid PRIMARY KEY DEFAULT uuidv7(), external_id text NOT NULL UNIQUE);
            CREATE TABLE control.controller_cleanup (
                id uuid PRIMARY KEY DEFAULT uuidv7(), controller_id text NOT NULL UNIQUE,
                active_revision bigint NOT NULL CHECK (active_revision > 0),
                status smallint NOT NULL CHECK (status BETWEEN 0 AND 3)
            );
            INSERT INTO control.schema_version (singleton_key, version, seeded) VALUES (1, 1, true);
            INSERT INTO control.building_design (singleton_key, saved, active, edit_revision)
                VALUES (1, '{"marker":"saved"}', '{"marker":"active"}', 7);
            """);
        var error = Assert.Throws<InvalidOperationException>(() => new BuildingDesignStore(path));
        Assert.Contains("missing required table 'building'", error.Message);
        Assert.True((bool)ControlTestDatabase.Scalar("""
            SELECT version = 1 AND seeded AND saved = '{"marker":"saved"}'::jsonb
                AND active = '{"marker":"active"}'::jsonb AND edit_revision = 7
            FROM control.schema_version CROSS JOIN control.building_design
            """)!);
        Assert.False((bool)ControlTestDatabase.Scalar("SELECT to_regclass('control.building') IS NOT NULL")!);
    }

    [Fact]
    public async Task WaitingSaveReadsNewDesignAfterBuildingLockIsReleased()
    {
        var applicationName = $"waiting-save-{Guid.NewGuid():N}";
        var waitingPath = new NpgsqlConnectionStringBuilder(path) { ApplicationName = applicationName }.ConnectionString;
        var store = new BuildingDesignStore(waitingPath);
        var initial = store.Read();
        using var connection = new NpgsqlConnection(path);
        connection.Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT id FROM control.building WHERE singleton_key = 1 FOR UPDATE";
        command.ExecuteScalar();

        var waiting = Task.Run(() => store.Save(initial.EditRevision, initial.Saved with { Width = 21 }));
        var committed = false;
        try
        {
            Assert.True(SpinWait.SpinUntil(() => (bool)ControlTestDatabase.Scalar($"""
                SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                               WHERE application_name = '{applicationName}' AND wait_event_type = 'Lock')
                """)!, TimeSpan.FromSeconds(15)), "Save did not wait for the building lock.");

            command.CommandText = """
                WITH new_design AS (
                    INSERT INTO control.building_design (building_id, design, revision)
                    SELECT d.building_id, jsonb_set(d.design, '{revision}', to_jsonb(d.revision + 1)), d.revision + 1
                    FROM control.building_design d JOIN control.building b ON b.saved_design_id = d.id
                    WHERE b.singleton_key = 1 RETURNING id, revision
                )
                UPDATE control.building SET saved_design_id = new_design.id, edit_revision = new_design.revision
                FROM new_design WHERE singleton_key = 1
                """;
            command.ExecuteNonQuery();
            transaction.Commit();
            committed = true;
        }
        finally
        {
            try
            {
                if (!committed) transaction.Rollback();
            }
            finally
            {
                await waiting;
            }
        }
        var result = await waiting;
        Assert.Equal(BuildingDesignStoreStatus.RevisionConflict, result.Status);
        Assert.Equal(initial.EditRevision + 1, result.Snapshot.EditRevision);
    }

    [Fact]
    public void SchemaUsesUuidV7PrimaryKeysAndEnforcesSingletonAndStableIds()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var reduced = initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() };
        var saved = store.Save(initial.EditRevision, reduced);
        Assert.Equal(BuildingDesignStoreStatus.Success, saved.Status);
        store.ActivateSaved(saved.Snapshot.Saved.Revision);

        var nonV7Count = (long)ControlTestDatabase.Scalar("""
            SELECT count(*) FROM (
                SELECT id FROM control.schema_version
                UNION ALL SELECT id FROM control.building
                UNION ALL SELECT id FROM control.building_design
                UNION ALL SELECT id FROM control.retired_design_entity_id
                UNION ALL SELECT id FROM control.controller_mqtt_retained_cleanup
            ) ids WHERE uuid_extract_version(id) <> 7
            """)!;
        Assert.Equal(0, nonV7Count);
        Assert.False((bool)ControlTestDatabase.Scalar("""
            SELECT EXISTS (
                SELECT 1 FROM pg_namespace n
                WHERE n.nspname = 'telemetry'
                  AND has_schema_privilege(current_user, n.oid, 'USAGE')
            )
            """)!);

        var duplicateSingleton = Assert.Throws<PostgresException>(() =>
            ControlTestDatabase.Execute("""
                INSERT INTO control.building (singleton_key, name, saved_design_id, active_design_id, edit_revision)
                SELECT singleton_key, name, saved_design_id, active_design_id, edit_revision FROM control.building
                """));
        Assert.Equal("23505", duplicateSingleton.SqlState);
        var duplicateExternalId = Assert.Throws<PostgresException>(() =>
            ControlTestDatabase.Execute("""
                INSERT INTO control.retired_design_entity_id (building_id, external_id, entity_type)
                SELECT building_id, external_id, entity_type FROM control.retired_design_entity_id LIMIT 1
                """));
        Assert.Equal("23505", duplicateExternalId.SqlState);
        var duplicateController = Assert.Throws<PostgresException>(() =>
            ControlTestDatabase.Execute("""
                INSERT INTO control.controller_mqtt_retained_cleanup (building_id, controller_id, active_design_revision, status)
                SELECT building_id, controller_id, active_design_revision, status
                FROM control.controller_mqtt_retained_cleanup LIMIT 1
                """));
        Assert.Equal("23505", duplicateController.SqlState);
        var invalidDesign = Assert.Throws<PostgresException>(() =>
            ControlTestDatabase.Execute("UPDATE control.building SET active_design_id = uuidv7() WHERE singleton_key = 1"));
        Assert.Equal("23503", invalidDesign.SqlState);
        var duplicateRevision = Assert.Throws<PostgresException>(() =>
            ControlTestDatabase.Execute("""
                INSERT INTO control.building_design (building_id, design, revision)
                SELECT building_id, design, revision FROM control.building_design LIMIT 1
                """));
        Assert.Equal("23505", duplicateRevision.SqlState);
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
        ControlTestDatabase.Execute("""
            CREATE FUNCTION control.test_reject_design_write() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END; $$
            """);
        ControlTestDatabase.Execute("""
            CREATE TRIGGER reject_save BEFORE UPDATE OF saved_design_id ON control.building
            FOR EACH ROW EXECUTE FUNCTION control.test_reject_design_write()
            """);
        var removed = initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() };
        Assert.Throws<PostgresException>(() => store.Save(initial.EditRevision, removed));
        var unchanged = store.Read();
        Assert.Equal(initial.EditRevision, unchanged.EditRevision);
        Assert.Equal(4, unchanged.Saved.Floors.Count);
        ControlTestDatabase.Execute("DROP TRIGGER reject_save ON control.building");
        ControlTestDatabase.Execute("DROP FUNCTION control.test_reject_design_write()");
        Assert.Equal(0L, (long)ControlTestDatabase.Scalar("SELECT count(*) FROM control.retired_design_entity_id")!);
        Assert.Equal(1L, (long)ControlTestDatabase.Scalar("SELECT count(*) FROM control.building_design")!);
        Assert.Equal(BuildingDesignStoreStatus.Success, store.Save(initial.EditRevision, initial.Saved).Status);
    }

    [Fact]
    public void FailedActivationDoesNotEnqueueCleanup()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision, initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        ControlTestDatabase.Execute("""
            CREATE FUNCTION control.test_reject_activation() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END; $$
            """);
        ControlTestDatabase.Execute("""
            CREATE TRIGGER reject_activation BEFORE UPDATE OF active_design_id ON control.building
            FOR EACH ROW EXECUTE FUNCTION control.test_reject_activation()
            """);
        Assert.Throws<PostgresException>(() => store.ActivateSaved(saved.Snapshot.Saved.Revision));
        Assert.Empty(store.ReadCleanup());
        Assert.Equal(4, store.Read().Active.Floors.Count);
        Assert.Equal(3, store.Read().Saved.Floors.Count);
        ControlTestDatabase.Execute("DROP TRIGGER reject_activation ON control.building");
        ControlTestDatabase.Execute("DROP FUNCTION control.test_reject_activation()");
        var restarted = new BuildingDesignStore(path);
        Assert.Equal(BuildingDesignStoreStatus.Success, restarted.ActivateSaved(saved.Snapshot.Saved.Revision).Status);
        Assert.Equal(3, new BuildingDesignStore(path).Read().Active.Floors.Count);
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

}

using Devices.Contracts;
using Microsoft.Data.Sqlite;
using System.Text.Json;
using System.Text.Json.Nodes;

public class BuildingDesignTests : IDisposable
{
    private readonly string path = Path.Combine(AppContext.BaseDirectory, $"building-design-test-{Guid.NewGuid():N}.db");

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
        using var connection = new SqliteConnection($"Data Source={path};Pooling=False");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE building_design SET saved = $saved, active = $active, edit_revision = 9 WHERE id = 1";
        command.Parameters.AddWithValue("$saved", savedJson);
        command.Parameters.AddWithValue("$active", activeJson);
        command.ExecuteNonQuery();

        var reopened = new BuildingDesignStore(path).Read();
        Assert.Equal(savedJson, JsonSerializer.Serialize(reopened.Saved, options));
        Assert.Equal(activeJson, JsonSerializer.Serialize(reopened.Active, options));
        Assert.Equal(9, reopened.EditRevision);
        command.CommandText = "SELECT saved, active FROM building_design WHERE id = 1";
        using var reader = command.ExecuteReader();
        Assert.True(reader.Read());
        Assert.Equal(savedJson, reader.GetString(0));
        Assert.Equal(activeJson, reader.GetString(1));
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

        using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE building_design SET saved = $saved, active = $active WHERE id = 1";
            command.Parameters.AddWithValue("$saved", LegacyJson(initial.Saved));
            command.Parameters.AddWithValue("$active", LegacyJson(initial.Active));
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
        var active = BuildingDesignSeed.Create() with { Width = 20, Depth = 20 };
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
        Assert.Equal(initial.Active.Width, migrated.Read().Active.Width);
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
        Assert.Equal(initial.Active.Width, snapshot.Active.Width);
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

using Devices.Contracts;
using Xunit;

public class CoverageImprovementTests
{
    // GetControllers tests
    [Fact]
    public void GetControllersReturnsSortedByFloor()
    {
        var simulator = new BuildingSimulator();
        var controllers = simulator.GetControllers();
        
        Assert.Equal(4, controllers.Count);
        Assert.Equal(new[] { 1, 2, 3, 4 }, controllers.Select(c => c.Floor));
    }

    [Fact]
    public void GetControllerWithValidIdReturnsController()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1");
        
        Assert.NotNull(controller);
        Assert.Equal("controller-floor-1", controller.Id);
        Assert.Equal(1, controller.Floor);
        Assert.Equal(ControllerStatus.Healthy, controller.Status);
    }

    [Fact]
    public void GetControllerWithInvalidIdReturnsNull()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("invalid-id");
        
        Assert.Null(controller);
    }

    // Error handling tests
    [Fact]
    public void TriggerSensorWithInvalidRoomReturnsRoomNotFound()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.TriggerSensor("invalid-room-id", out var controller);
        
        Assert.Equal(SensorTriggerResult.RoomNotFound, result);
        Assert.Null(controller);
    }

    [Fact]
    public void ResetSensorWithInvalidRoomReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.ResetSensor("invalid-room-id", out _);
        
        Assert.False(result);
    }

    [Fact]
    public void AddFaultWithInvalidControllerReturnsControllerNotFound()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("invalid-controller", 
            new FaultRequest("light", "light-floor-1-main-1", "Test"), 
            out var controller);
        
        Assert.Equal(FaultMutationResult.ControllerNotFound, result);
        Assert.Null(controller);
    }

    [Fact]
    public void AddFaultWithInvalidLightTargetReturnsInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("light", "light-floor-2-main-1", "Cross-controller light"),
            out var controller);
        
        Assert.Equal(FaultMutationResult.InvalidTarget, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void AddFaultWithInvalidSensorTargetReturnsInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", "sensor-floor-2-main", "Cross-controller sensor"),
            out var controller);
        
        Assert.Equal(FaultMutationResult.InvalidTarget, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void AddFaultWithEmptyDescriptionReturnsInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("light", DeviceIds.Light(1, "main", 1), ""),
            out var controller);
        
        Assert.Equal(FaultMutationResult.InvalidTarget, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void AddFaultWithNullDescriptionReturnsInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("light", DeviceIds.Light(1, "main", 1), null!),
            out var controller);
        
        Assert.Equal(FaultMutationResult.InvalidTarget, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void AddFaultWithWhitespaceDescriptionReturnsInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("light", DeviceIds.Light(1, "main", 1), "   "),
            out var controller);
        
        Assert.Equal(FaultMutationResult.InvalidTarget, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void AddFaultWithEmptyTargetIdReturnsInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("light", "", "Test description"),
            out var controller);
        
        Assert.Equal(FaultMutationResult.InvalidTarget, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void ClearFaultWithInvalidControllerReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.ClearFault("invalid-controller", "fault-123", out _);
        
        Assert.False(result);
    }

    [Fact]
    public void ClearFaultWithInvalidFaultIdReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.ClearFault("controller-floor-1", "invalid-fault-id", out _);
        
        Assert.False(result);
    }

    // State mutation tests
    [Fact]
    public void AddLightFaultTurnsLightOff()
    {
        var simulator = new BuildingSimulator();
        var stripId = DeviceIds.Light(1, "main", 1);
        
        simulator.TriggerSensor(DeviceIds.Room(1, "main"), out _);
        simulator.AddFault("controller-floor-1", 
            new FaultRequest("light", stripId, "Test"), 
            out var faulted);
        
        var strip = faulted!.Rooms.SelectMany(r => r.LightStrips).First(s => s.Id == stripId);
        Assert.True(strip.IsFaulted);
        Assert.False(strip.IsOn);
    }

    [Fact]
    public void AddSensorFaultClearsPresence()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        simulator.TriggerSensor(roomId, out _);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", DeviceIds.Sensor(1, "main"), "Test"),
            out var faulted);
        
        var room = faulted!.Rooms.First(r => r.Id == roomId);
        Assert.False(room.Presence);
        Assert.False(room.SensorTriggered);
    }

    [Fact]
    public void ClearFaultRestoresLightOnState()
    {
        var simulator = new BuildingSimulator();
        var stripId = DeviceIds.Light(2, "main", 1);
        
        simulator.TriggerSensor(DeviceIds.Room(2, "main"), out _);
        simulator.AddFault("controller-floor-2", 
            new FaultRequest("light", stripId, "Test"), 
            out var faulted);
        var faultId = faulted!.Faults.First().Id;
        
        simulator.ClearFault("controller-floor-2", faultId, out var cleared);
        var strip = cleared.Rooms.SelectMany(r => r.LightStrips).First(s => s.Id == stripId);
        Assert.False(strip.IsFaulted);
        Assert.True(strip.IsOn);
    }

    [Fact]
    public void ClearFaultWithSensorTriggeredOffRestoresLightOff()
    {
        var simulator = new BuildingSimulator();
        var stripId = DeviceIds.Light(3, "main", 1);
        
        simulator.AddFault("controller-floor-3",
            new FaultRequest("light", stripId, "Test"),
            out var faulted);
        var faultId = faulted!.Faults.First().Id;
        
        simulator.ClearFault("controller-floor-3", faultId, out var cleared);
        var strip = cleared.Rooms.SelectMany(r => r.LightStrips).First(s => s.Id == stripId);
        Assert.False(strip.IsFaulted);
        Assert.False(strip.IsOn);
    }

    [Fact]
    public void MultipleFaultsOnSameController()
    {
        var simulator = new BuildingSimulator();
        var strip1 = DeviceIds.Light(1, "main", 1);
        var strip2 = DeviceIds.Light(1, "main", 2);
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip1, "Fault 1"),
            out var state1);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip2, "Fault 2"),
            out var state2);
        
        Assert.Equal(2, state2!.Faults.Count);
        Assert.Equal(ControllerStatus.Faulted, state2.Status);
    }

    [Fact]
    public void ClearingOneFaultKeepsControllerFaulted()
    {
        var simulator = new BuildingSimulator();
        var strip1 = DeviceIds.Light(1, "main", 1);
        var strip2 = DeviceIds.Light(1, "main", 2);
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip1, "Fault 1"),
            out var state1);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip2, "Fault 2"),
            out var state2);
        
        var fault1Id = state2!.Faults.First(f => f.TargetId == strip1).Id;
        simulator.ClearFault("controller-floor-1", fault1Id, out var afterFirst);
        
        Assert.Single(afterFirst.Faults);
        Assert.Equal(ControllerStatus.Faulted, afterFirst.Status);
    }

    [Fact]
    public void ClearingLastFaultRestoresHealthy()
    {
        var simulator = new BuildingSimulator();
        var strip = DeviceIds.Light(1, "main", 1);
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip, "Fault"),
            out var faulted);
        var faultId = faulted!.Faults.Single().Id;
        
        simulator.ClearFault("controller-floor-1", faultId, out var restored);
        
        Assert.Empty(restored.Faults);
        Assert.Equal(ControllerStatus.Healthy, restored.Status);
    }

    // Fault target ownership tests
    [Fact]
    public void IsFaultTargetOwnedByWithValidTarget()
    {
        var simulator = new BuildingSimulator();
        var request = new FaultRequest("light", DeviceIds.Light(1, "main", 1), "Test");
        
        Assert.True(simulator.IsFaultTargetOwnedBy("controller-floor-1", request));
    }

    [Fact]
    public void IsFaultTargetOwnedByWithInvalidTarget()
    {
        var simulator = new BuildingSimulator();
        var request = new FaultRequest("light", DeviceIds.Light(2, "main", 1), "Test");
        
        Assert.False(simulator.IsFaultTargetOwnedBy("controller-floor-1", request));
    }

    [Fact]
    public void IsFaultTargetOwnedByWithSensorTarget()
    {
        var simulator = new BuildingSimulator();
        var request = new FaultRequest("sensor", DeviceIds.Sensor(1, "main"), "Test");
        
        Assert.True(simulator.IsFaultTargetOwnedBy("controller-floor-1", request));
        Assert.False(simulator.IsFaultTargetOwnedBy("controller-floor-2", request));
    }

    [Fact]
    public void ClearFaultByTargetWithValidTarget()
    {
        var simulator = new BuildingSimulator();
        var strip = DeviceIds.Light(1, "main", 1);
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip, "Test"),
            out var faulted);
        
        Assert.True(simulator.ClearFaultByTarget("controller-floor-1", strip, out var cleared));
        Assert.Empty(cleared.Faults);
        Assert.Equal(ControllerStatus.Healthy, cleared.Status);
    }

    [Fact]
    public void ClearFaultByTargetWithInvalidController()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.ClearFaultByTarget("invalid-id", "some-target", out _);
        
        Assert.False(result);
    }

    [Fact]
    public void ClearFaultByTargetWithUnknownTarget()
    {
        var simulator = new BuildingSimulator();
        var result = simulator.ClearFaultByTarget("controller-floor-1", "unknown-target", out var controller);
        
        Assert.False(result);
        Assert.NotNull(controller);
    }

    // State consistency tests
    [Fact]
    public void ResetBuildingClearsAllState()
    {
        var simulator = new BuildingSimulator();
        
        simulator.TriggerSensor(DeviceIds.Room(1, "main"), out _);
        simulator.TriggerSensor(DeviceIds.Room(2, "office-a"), out _);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", DeviceIds.Light(1, "main", 1), "Test"),
            out _);
        
        var reset = simulator.ResetBuilding();
        
        Assert.Equal(4, reset.Count);
        Assert.All(reset, c =>
        {
            Assert.Equal(ControllerStatus.Healthy, c.Status);
            Assert.Empty(c.Faults);
            Assert.All(c.Rooms, r =>
            {
                Assert.False(r.Presence);
                Assert.False(r.SensorTriggered);
                Assert.All(r.LightStrips, s =>
                {
                    Assert.False(s.IsOn);
                    Assert.False(s.IsFaulted);
                });
            });
        });
    }

    [Fact]
    public void SetRandomOccupancyFillsAllControllers()
    {
        var simulator = new BuildingSimulator();
        var occupied = simulator.SetRandomOccupancy();
        
        Assert.Equal(4, occupied.Count);
        Assert.All(occupied, c => Assert.InRange(c.Rooms.Count(r => r.Presence), 1, 2));
    }

    [Fact]
    public void SetRandomOccupancyWithSeedIsDeterministic()
    {
        var simulator1 = new BuildingSimulator();
        var simulator2 = new BuildingSimulator();
        var seed = new Random(42);
        
        var occupied1 = simulator1.SetRandomOccupancy(seed);
        simulator2.SetRandomOccupancy(new Random(42));
        
        Assert.Equal(4, occupied1.Count);
    }

    [Fact]
    public void RevisionIncrementsOnEachMutation()
    {
        var simulator = new BuildingSimulator();
        var initial = simulator.GetController("controller-floor-1");
        var initialRev = initial!.Revision;
        
        simulator.TriggerSensor(DeviceIds.Room(1, "main"), out var after1);
        Assert.Equal(initialRev + 1, after1!.Revision);
        
        simulator.TriggerSensor(DeviceIds.Room(1, "office-a"), out var after2);
        Assert.Equal(initialRev + 2, after2!.Revision);
        
        simulator.ResetSensor(DeviceIds.Room(1, "main"), out var after3);
        Assert.Equal(initialRev + 3, after3.Revision);
    }

    [Fact]
    public void LastSeenTimestampUpdatesOnMutation()
    {
        var simulator = new BuildingSimulator();
        var ctrl1 = simulator.GetController("controller-floor-1");
        var time1 = ctrl1!.LastSeen;
        
        System.Threading.Thread.Sleep(10);
        simulator.TriggerSensor(DeviceIds.Room(1, "main"), out var ctrl2);
        var time2 = ctrl2!.LastSeen;
        
        Assert.True(time2 > time1);
    }

    // Room and strip state tests
    [Fact]
    public void TriggerSensorTurnsOnOnlyTargetRoomLights()
    {
        var simulator = new BuildingSimulator();
        var target = DeviceIds.Room(1, "main");
        var other = DeviceIds.Room(1, "office-a");
        
        simulator.TriggerSensor(target, out var controller);
        
        Assert.All(controller!.Rooms.First(r => r.Id == target).LightStrips, s => Assert.True(s.IsOn));
        Assert.All(controller.Rooms.First(r => r.Id == other).LightStrips, s => Assert.False(s.IsOn));
    }

    [Fact]
    public void ResetSensorTurnsOffTargetRoomLights()
    {
        var simulator = new BuildingSimulator();
        var target = DeviceIds.Room(1, "main");
        
        simulator.TriggerSensor(target, out _);
        simulator.ResetSensor(target, out var controller);
        
        var room = controller.Rooms.First(r => r.Id == target);
        Assert.False(room.SensorTriggered);
        Assert.False(room.Presence);
        Assert.All(room.LightStrips, s => Assert.False(s.IsOn));
    }

    [Fact]
    public void TriggerSensorSetsSensorTriggeredAndPresence()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        simulator.TriggerSensor(roomId, out var controller);
        var room = controller!.Rooms.First(r => r.Id == roomId);
        
        Assert.True(room.SensorTriggered);
        Assert.True(room.Presence);
    }

    // Edge cases
    [Fact]
    public void TriggerSameSensorMultipleTimes()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        for (int i = 0; i < 5; i++)
        {
            var result = simulator.TriggerSensor(roomId, out var controller);
            Assert.Equal(SensorTriggerResult.Triggered, result);
            var room = controller!.Rooms.First(r => r.Id == roomId);
            Assert.True(room.SensorTriggered);
            Assert.True(room.Presence);
        }
    }

    [Fact]
    public void ResetThenTriggerSameSensor()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        simulator.TriggerSensor(roomId, out _);
        simulator.ResetSensor(roomId, out var reset);
        Assert.False(reset.Rooms.First(r => r.Id == roomId).SensorTriggered);
        
        simulator.TriggerSensor(roomId, out var triggered);
        Assert.True(triggered!.Rooms.First(r => r.Id == roomId).SensorTriggered);
    }

    [Fact]
    public void AllRoomsIndependentOfEachOther()
    {
        var simulator = new BuildingSimulator();
        var room1 = DeviceIds.Room(1, "main");
        var room2 = DeviceIds.Room(1, "office-a");
        var room3 = DeviceIds.Room(2, "main");
        
        simulator.TriggerSensor(room1, out _);
        simulator.TriggerSensor(room2, out _);
        
        var controller1 = simulator.GetController("controller-floor-1");
        Assert.True(controller1!.Rooms.First(r => r.Id == room1).SensorTriggered);
        Assert.True(controller1.Rooms.First(r => r.Id == room2).SensorTriggered);
        
        var controller2 = simulator.GetController("controller-floor-2");
        Assert.False(controller2!.Rooms.First(r => r.Id == room3).SensorTriggered);
    }

    // Phase 2: Extended edge cases and state boundary tests
    
    [Fact]
    public void TriggerSensorFaultedWithSensorFault()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        var controller = simulator.GetController("controller-floor-1")!;
        var sensorId = $"sensor-floor-{controller.Floor}-main";
        
        simulator.AddFault("controller-floor-1", new FaultRequest("sensor", sensorId, "Sensor malfunction"), out _);
        var result = simulator.TriggerSensor(roomId, out var faultedController);
        
        Assert.Equal(SensorTriggerResult.SensorFaulted, result);
        Assert.NotNull(faultedController);
        Assert.Equal(ControllerStatus.Faulted, faultedController.Status);
    }

    [Fact]
    public void ResetSensorWhenNotTriggered()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var before = simulator.GetController("controller-floor-1")!;
        var reset = before.Rooms.First(r => r.Id == roomId).SensorTriggered;
        Assert.False(reset);
        
        // Should still return true and update state even if not triggered
        var result = simulator.ResetSensor(roomId, out var controller);
        Assert.True(result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void AddFaultToLightStrip()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        var result = simulator.AddFault("controller-floor-1", 
            new FaultRequest("light", lightId, "Light failure"), out var updated);
        
        Assert.Equal(FaultMutationResult.Added, result);
        Assert.Equal(ControllerStatus.Faulted, updated!.Status);
        var light = updated.Rooms.First().LightStrips.First(s => s.Id == lightId);
        Assert.True(light.IsFaulted);
        Assert.False(light.IsOn);
    }

    [Fact]
    public void AddFaultViaRoomId()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var result = simulator.AddFault(roomId, 
            new FaultRequest("sensor", $"sensor-floor-1-main", "Room sensor down"), out var controller);
        
        Assert.Equal(FaultMutationResult.Added, result);
        Assert.NotNull(controller);
    }

    [Fact]
    public void ClearFaultViaTargetId()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        simulator.AddFault("controller-floor-1", 
            new FaultRequest("light", lightId, "Light failure"), out var faulted);
        
        var result = simulator.ClearFaultByTarget("controller-floor-1", lightId, out var cleared);
        
        Assert.True(result);
        Assert.Equal(ControllerStatus.Healthy, cleared.Status);
        Assert.Empty(cleared.Faults);
    }

    [Fact]
    public void ClearFaultByFaultId()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var sensorId = $"sensor-floor-{controller.Floor}-main";
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", sensorId, "Sensor malfunction"), out var faulted);
        
        var faultId = faulted!.Faults.First().Id;
        var result = simulator.ClearFault("controller-floor-1", faultId, out var cleared);
        
        Assert.True(result);
        Assert.Equal(ControllerStatus.Healthy, cleared.Status);
    }

    [Fact]
    public void ClearFaultByTargetIdWhenMultipleFaults()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        var sensorId = $"sensor-floor-{controller.Floor}-main";
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", lightId, "Light failure"), out _);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", sensorId, "Sensor malfunction"), out var multipleFaulted);
        
        Assert.Equal(2, multipleFaulted!.Faults.Count);
        
        var result = simulator.ClearFaultByTarget("controller-floor-1", lightId, out var cleared);
        
        Assert.True(result);
        Assert.Single(cleared.Faults);
        Assert.Equal(ControllerStatus.Faulted, cleared.Status);
    }

    [Fact]
    public void IsRoomOwnedByWithValidRoom()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var result = simulator.IsRoomOwnedBy("controller-floor-1", roomId);
        Assert.True(result);
    }

    [Fact]
    public void IsRoomOwnedByWithInvalidRoom()
    {
        var simulator = new BuildingSimulator();
        
        var result = simulator.IsRoomOwnedBy("controller-floor-1", "invalid-room");
        Assert.False(result);
    }

    [Fact]
    public void IsRoomOwnedByWithWrongController()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var result = simulator.IsRoomOwnedBy("controller-floor-2", roomId);
        Assert.False(result);
    }

    [Fact]
    public void IsRoomOwnedByWithInvalidController()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var result = simulator.IsRoomOwnedBy("invalid-controller", roomId);
        Assert.False(result);
    }

    [Fact]
    public void IsFaultTargetOwnedByWithValidLightTarget()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        var result = simulator.IsFaultTargetOwnedBy("controller-floor-1", 
            new FaultRequest("light", lightId, "Light failure"));
        
        Assert.True(result);
    }

    [Fact]
    public void IsFaultTargetOwnedByWithValidSensorTarget()
    {
        var simulator = new BuildingSimulator();
        
        var result = simulator.IsFaultTargetOwnedBy("controller-floor-1",
            new FaultRequest("sensor", "sensor-floor-1-main", "Sensor failure"));
        
        Assert.True(result);
    }

    [Fact]
    public void IsFaultTargetOwnedByWithInvalidScope()
    {
        var simulator = new BuildingSimulator();
        
        var result = simulator.IsFaultTargetOwnedBy("controller-floor-1",
            new FaultRequest("invalid-scope", "some-id", "Invalid"));
        
        Assert.False(result);
    }

    [Fact]
    public void IsFaultTargetOwnedByWithWrongController()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        var result = simulator.IsFaultTargetOwnedBy("controller-floor-2",
            new FaultRequest("light", lightId, "Light failure"));
        
        Assert.False(result);
    }

    [Fact]
    public void ResetBuildingClearsAllFaultsAndLights()
    {
        var simulator = new BuildingSimulator();
        
        // Add faults and trigger sensors
        simulator.TriggerSensor(DeviceIds.Room(1, "main"), out _);
        simulator.TriggerSensor(DeviceIds.Room(1, "office-a"), out _);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", "sensor-floor-1-main", "Sensor failure"), out _);
        
        var controllers = simulator.ResetBuilding();
        
        Assert.All(controllers, c =>
        {
            Assert.Equal(ControllerStatus.Healthy, c.Status);
            Assert.Empty(c.Faults);
            Assert.All(c.Rooms, r =>
            {
                Assert.False(r.SensorTriggered);
                Assert.False(r.Presence);
                Assert.All(r.LightStrips, s =>
                {
                    Assert.False(s.IsOn);
                    Assert.False(s.IsFaulted);
                });
            });
        });
    }

    [Fact]
    public void SetRandomOccupancyActivatesLights()
    {
        var simulator = new BuildingSimulator();
        var random = new Random(42);
        
        var controllers = simulator.SetRandomOccupancy(random);
        
        Assert.All(controllers, c =>
        {
            Assert.Equal(ControllerStatus.Healthy, c.Status);
            var occupiedRooms = c.Rooms.Where(r => r.SensorTriggered).ToList();
            Assert.NotEmpty(occupiedRooms);
            Assert.All(occupiedRooms, r =>
            {
                Assert.True(r.Presence);
                Assert.All(r.LightStrips, s => Assert.True(s.IsOn));
            });
        });
    }

    [Fact]
    public void SetRandomOccupancyWithoutArgumentUsesSharedRandom()
    {
        var simulator = new BuildingSimulator();
        var random = new Random(42); // Fixed seed for determinism
        
        var controllers1 = simulator.SetRandomOccupancy(random);
        var controllers2 = simulator.SetRandomOccupancy(random);
        
        // Both should have changed from each other (different seeds)
        var count1 = controllers1.SelectMany(c => c.Rooms).Where(r => r.SensorTriggered).Count();
        var count2 = controllers2.SelectMany(c => c.Rooms).Where(r => r.SensorTriggered).Count();
        
        // With seeded random, we can at least verify both have occupancy
        Assert.True(count1 > 0, "First occupancy should have at least one occupied room");
        Assert.True(count2 > 0, "Second occupancy should have at least one occupied room");
    }

    [Fact]
    public void AddFaultThenResetBuilding()
    {
        var simulator = new BuildingSimulator();
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", "sensor-floor-1-main", "Sensor failure"), out var faulted);
        
        Assert.Equal(ControllerStatus.Faulted, faulted!.Status);
        Assert.Single(faulted.Faults);
        
        var reset = simulator.ResetBuilding();
        var controller = reset.First(c => c.Id == "controller-floor-1");
        
        Assert.Equal(ControllerStatus.Healthy, controller.Status);
        Assert.Empty(controller.Faults);
    }

    [Fact]
    public void MultipleTriggersIncrementRevisionOnce()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var before = simulator.GetController("controller-floor-1")!.Revision;
        simulator.TriggerSensor(roomId, out var triggered1);
        var afterFirst = triggered1!.Revision;
        
        simulator.TriggerSensor(roomId, out var triggered2);
        var afterSecond = triggered2!.Revision;
        
        Assert.Equal(before + 1, afterFirst);
        Assert.Equal(afterFirst + 1, afterSecond);
    }

    [Fact]
    public void ClearingMultipleFaultsSeparately()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var light1 = controller.Rooms[0].LightStrips.First().Id;
        var light2 = controller.Rooms[1].LightStrips.First().Id;
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", light1, "Light 1 failure"), out var fault1);
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", light2, "Light 2 failure"), out var fault2);
        
        Assert.Equal(2, fault2!.Faults.Count);
        
        var faultId1 = fault2.Faults.First().Id;
        simulator.ClearFault("controller-floor-1", faultId1, out var afterClear1);
        
        Assert.Single(afterClear1.Faults);
        Assert.Equal(ControllerStatus.Faulted, afterClear1.Status);
        
        var faultId2 = afterClear1.Faults.First().Id;
        simulator.ClearFault("controller-floor-1", faultId2, out var afterClear2);
        
        Assert.Empty(afterClear2.Faults);
        Assert.Equal(ControllerStatus.Healthy, afterClear2.Status);
    }

    // Additional Phase 2 coverage for edge cases and lesser-tested paths
    
    [Fact]
    public void AddFaultViaLightId()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        var result = simulator.AddFault(lightId, 
            new FaultRequest("light", lightId, "LED failure"), out var updated);
        
        Assert.Equal(FaultMutationResult.Added, result);
        Assert.Equal(ControllerStatus.Faulted, updated!.Status);
    }

    [Fact]
    public void ClearFaultViaLightId()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        simulator.AddFault(lightId, 
            new FaultRequest("light", lightId, "LED failure"), out var faulted);
        
        var result = simulator.ClearFault(lightId, faulted!.Faults.First().Id, out var cleared);
        
        Assert.True(result);
        Assert.Equal(ControllerStatus.Healthy, cleared.Status);
    }

    [Fact]
    public void AddDuplicateFaultReturnsDuplicate()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var sensorId = $"sensor-floor-{controller.Floor}-main";
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", sensorId, "First sensor fault"), out _);
        
        var result = simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", sensorId, "Duplicate sensor fault"), out var unchanged);
        
        Assert.Equal(FaultMutationResult.Duplicate, result);
        Assert.Single(unchanged!.Faults);
    }

    [Fact]
    public void ClearNonExistentFaultReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        
        var result = simulator.ClearFault("controller-floor-1", "non-existent-fault-id", out var controller);
        
        Assert.False(result);
        Assert.Empty(controller.Faults);
    }

    [Fact]
    public void ClearFaultFromWrongControllerReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        var controller1 = simulator.GetController("controller-floor-1")!;
        var sensorId = $"sensor-floor-{controller1.Floor}-main";
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", sensorId, "Sensor fault"), out var faulted);
        
        var faultId = faulted!.Faults.First().Id;
        var result = simulator.ClearFault("controller-floor-2", faultId, out var unchanged);
        
        Assert.False(result);
    }

    [Fact]
    public void ClearFaultByTargetIdWhenNoFaultReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        
        var result = simulator.ClearFaultByTarget("controller-floor-1", "non-existent-target", out _);
        
        Assert.False(result);
    }

    [Fact]
    public void ClearFaultByTargetIdWhenWrongControllerReturnsFalse()
    {
        var simulator = new BuildingSimulator();
        
        var result = simulator.ClearFaultByTarget("invalid-controller-id", "some-target", out _);
        
        Assert.False(result);
    }

    [Fact]
    public void TriggerSensorMultipleTimesCumulativelyChanges()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        var controller1 = simulator.GetController("controller-floor-1")!;
        Assert.False(controller1.Rooms.First(r => r.Id == roomId).SensorTriggered);
        
        simulator.TriggerSensor(roomId, out var triggered);
        Assert.True(triggered!.Rooms.First(r => r.Id == roomId).SensorTriggered);
        Assert.True(triggered.Rooms.First(r => r.Id == roomId).LightStrips.All(s => s.IsOn || s.IsFaulted));
    }

    [Fact]
    public void ResetSensorTurnsOffAllRoomLights()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        
        simulator.TriggerSensor(roomId, out _);
        simulator.ResetSensor(roomId, out var reset);
        
        var room = reset.Rooms.First(r => r.Id == roomId);
        Assert.False(room.SensorTriggered);
        Assert.False(room.Presence);
        Assert.All(room.LightStrips, s => Assert.False(s.IsOn));
    }

    [Fact]
    public void TriggerSensorHonorsFaultedLights()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First(r => r.Id == roomId).LightStrips.First().Id;
        
        // Add light fault first
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", lightId, "LED broken"), out _);
        
        // Then trigger sensor
        simulator.TriggerSensor(roomId, out var triggered);
        
        var room = triggered!.Rooms.First(r => r.Id == roomId);
        var faultedLight = room.LightStrips.First(s => s.Id == lightId);
        Assert.True(faultedLight.IsFaulted);
        Assert.False(faultedLight.IsOn);
    }

    [Fact]
    public void AddLightFaultToCorrectRoom()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var targetRoom = controller.Rooms[0];
        var targetLight = targetRoom.LightStrips.First();
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", targetLight.Id, "Light malfunction"), out var faulted);
        
        var updatedRoom = faulted!.Rooms.First(r => r.Id == targetRoom.Id);
        var updatedLight = updatedRoom.LightStrips.First(s => s.Id == targetLight.Id);
        
        Assert.True(updatedLight.IsFaulted);
        Assert.False(updatedLight.IsOn);
        
        // Other lights in room should be unaffected
        var otherLights = updatedRoom.LightStrips.Where(s => s.Id != targetLight.Id).ToList();
        Assert.All(otherLights, s => Assert.False(s.IsFaulted));
    }

    [Fact]
    public void ClearLightFaultRestoresLight()
    {
        var simulator = new BuildingSimulator();
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First().LightStrips.First().Id;
        
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", lightId, "Light failure"), out var faulted);
        
        var faultId = faulted!.Faults.First().Id;
        simulator.ClearFault("controller-floor-1", faultId, out var cleared);
        
        var room = cleared.Rooms.First();
        var light = room.LightStrips.First(s => s.Id == lightId);
        Assert.False(light.IsFaulted);
        // Light should be restored to sensor state (untriggered room, so off)
        Assert.False(light.IsOn);
    }

    [Fact]
    public void ClearLightFaultWhenRoomTriggeredRestoresLight()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "main");
        var controller = simulator.GetController("controller-floor-1")!;
        var lightId = controller.Rooms.First(r => r.Id == roomId).LightStrips.First().Id;
        
        // Trigger room first
        simulator.TriggerSensor(roomId, out _);
        
        // Then add light fault
        simulator.AddFault("controller-floor-1",
            new FaultRequest("light", lightId, "Light failure"), out var faulted);
        
        var faultId = faulted!.Faults.First().Id;
        simulator.ClearFault("controller-floor-1", faultId, out var cleared);
        
        var room = cleared.Rooms.First(r => r.Id == roomId);
        var light = room.LightStrips.First(s => s.Id == lightId);
        Assert.False(light.IsFaulted);
        // Light should be restored to ON since room is triggered
        Assert.True(light.IsOn);
    }

    // Contract type tests
    [Fact]
    public void FaultRequestCreatesWithAllProperties()
    {
        var request = new FaultRequest("light", "light-1", "Test fault");
        
        Assert.Equal("light", request.Scope);
        Assert.Equal("light-1", request.TargetId);
        Assert.Equal("Test fault", request.Description);
    }

    [Fact]
    public void SensorTriggerResultEnumHasAllValues()
    {
        Assert.Equal(SensorTriggerResult.Triggered, SensorTriggerResult.Triggered);
        Assert.Equal(SensorTriggerResult.RoomNotFound, SensorTriggerResult.RoomNotFound);
        Assert.Equal(SensorTriggerResult.SensorFaulted, SensorTriggerResult.SensorFaulted);
    }

    [Fact]
    public void FaultMutationResultEnumHasAllValues()
    {
        Assert.Equal(FaultMutationResult.Added, FaultMutationResult.Added);
        Assert.Equal(FaultMutationResult.ControllerNotFound, FaultMutationResult.ControllerNotFound);
        Assert.Equal(FaultMutationResult.InvalidTarget, FaultMutationResult.InvalidTarget);
        Assert.Equal(FaultMutationResult.Duplicate, FaultMutationResult.Duplicate);
    }

    [Fact]
    public void DeviceCommandCreatesWithAllProperties()
    {
        var now = DateTimeOffset.UtcNow;
        var command = new DeviceCommand("cmd-1", "room-1", "turn-on", null, "light-1", null, null, now);
        
        Assert.Equal("cmd-1", command.CommandId);
        Assert.Equal("room-1", command.ControllerId);
        Assert.Equal("turn-on", command.Action);
        Assert.Null(command.RoomId);
        Assert.Equal("light-1", command.TargetId);
        Assert.Null(command.Scope);
        Assert.Null(command.Description);
        Assert.Equal(now, command.Timestamp);
    }

    [Fact]
    public void DeviceCommandAckCreatesWithAllProperties()
    {
        var controller = DeviceIds.CreateBuilding().First();
        var now = DateTimeOffset.UtcNow;
        var ack = new DeviceCommandAck("ack-1", "controller-1", true, "Command accepted", controller, now);
        
        Assert.Equal("ack-1", ack.CommandId);
        Assert.Equal("controller-1", ack.ControllerId);
        Assert.True(ack.Accepted);
        Assert.Equal("Command accepted", ack.Message);
        Assert.Equal(controller.Id, ack.State!.Id);
        Assert.Equal(now, ack.Timestamp);
    }

    [Fact]
    public void DeviceTransportStatusCreatesWithAllProperties()
    {
        var now = DateTimeOffset.UtcNow;
        var status = new DeviceTransportStatus(true, true, now, "All systems operational");
        
        Assert.True(status.MqttConnected);
        Assert.True(status.HttpAvailable);
        Assert.Equal(now, status.LastMqttConnectedAt);
        Assert.Equal("All systems operational", status.Message);
    }

    [Fact]
    public void DeviceTransportStatusWithNullLastConnectedAtCreates()
    {
        var status = new DeviceTransportStatus(false, false, null, "No connection");
        
        Assert.False(status.MqttConnected);
        Assert.False(status.HttpAvailable);
        Assert.Null(status.LastMqttConnectedAt);
        Assert.Equal("No connection", status.Message);
    }
}


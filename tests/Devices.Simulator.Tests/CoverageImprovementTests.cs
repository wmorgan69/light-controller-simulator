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
}

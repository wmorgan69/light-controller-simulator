using Devices.Contracts;
using Xunit;

public class BuildingSimulatorTests
{
    [Fact]
    public void BuildingHasFourControllersAndTwentyFourStrips()
    {
        var controllers = DeviceIds.CreateBuilding().ToArray();

        Assert.Equal(4, controllers.Length);
        Assert.Equal(12, controllers.Sum(controller => controller.Rooms.Count));
        Assert.Equal(24, controllers.Sum(controller => controller.Rooms.Sum(room => room.LightStrips.Count)));
    }

    [Fact]
    public void TriggerOnlyChangesSelectedRoomLights()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(2, "office-a");

        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor(roomId, out var controller));
        Assert.NotNull(controller);
        Assert.True(controller.Rooms.Single(room => room.Id == roomId).LightStrips.All(strip => strip.IsOn));
        Assert.True(controller.Rooms.Where(room => room.Id != roomId).All(room => room.LightStrips.All(strip => !strip.IsOn)));
    }

    [Fact]
    public void FaultCanBeInjectedAndCleared()
    {
        var simulator = new BuildingSimulator();
        var stripId = DeviceIds.Light(3, "main", 1);

        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-3",
            new FaultRequest("light", stripId, "Test strip fault"), out var faulted));
        Assert.NotNull(faulted);
        Assert.Equal(ControllerStatus.Faulted, faulted.Status);
        Assert.True(faulted.Rooms.SelectMany(room => room.LightStrips).Single(strip => strip.Id == stripId).IsFaulted);

        var faultId = faulted.Faults.Single().Id;
        Assert.True(simulator.ClearFault("controller-floor-3", faultId, out var restored));
        Assert.Equal(ControllerStatus.Healthy, restored.Status);
        Assert.False(restored.Rooms.SelectMany(room => room.LightStrips).Single(strip => strip.Id == stripId).IsFaulted);
    }

    [Fact]
    public void SensorFaultUsesStableSensorIdAndClearsPresence()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(1, "office-b");
        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor(roomId, out _));

        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", DeviceIds.Sensor(1, "office-b"), "Sensor fault"), out var faulted));
        Assert.NotNull(faulted);
        Assert.False(faulted.Rooms.Single(room => room.Id == roomId).Presence);
        Assert.Equal(SensorTriggerResult.SensorFaulted, simulator.TriggerSensor(roomId, out _));

        Assert.True(simulator.ClearFault("controller-floor-1", faulted.Faults.Single().Id, out var restored));
        Assert.False(restored.Rooms.Single(room => room.Id == roomId).Presence);
    }

    [Fact]
    public void FaultCannotTargetAnotherControllerOrBeDuplicated()
    {
        var simulator = new BuildingSimulator();
        var foreignStrip = DeviceIds.Light(2, "office-a", 1);
        Assert.Equal(FaultMutationResult.InvalidTarget, simulator.AddFault("controller-floor-1",
            new FaultRequest("light", foreignStrip, "Invalid cross-controller fault"), out _));

        var strip = DeviceIds.Light(1, "office-a", 1);
        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip, "Test fault"), out _));
        Assert.Equal(FaultMutationResult.Duplicate, simulator.AddFault("controller-floor-1",
            new FaultRequest("light", strip, "Duplicate fault"), out _));
    }

    [Fact]
    public void SensorCanBeResetAfterTrigger()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(4, "office-b");

        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor(roomId, out _));
        Assert.True(simulator.ResetSensor(roomId, out var reset));
        Assert.False(reset.Rooms.Single(room => room.Id == roomId).Presence);
        Assert.False(reset.Rooms.Single(room => room.Id == roomId).SensorTriggered);
        Assert.All(reset.Rooms.Single(room => room.Id == roomId).LightStrips,
            strip => Assert.False(strip.IsOn));
    }

    [Fact]
    public void ClearingSensorFaultRestoresHealthyControllerAndNoFaultState()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(3, "main");
        var sensorId = DeviceIds.Sensor(3, "main");

        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-3",
            new FaultRequest("sensor", sensorId, "Sensor fault"), out var faulted));
        Assert.NotNull(faulted);
        Assert.Equal(ControllerStatus.Faulted, faulted.Status);
        Assert.Contains(faulted.Faults, fault => fault.Scope == "sensor" && fault.TargetId == sensorId);

        Assert.True(simulator.ClearFault("controller-floor-3", faulted.Faults.Single().Id, out var restored));
        Assert.NotNull(restored);
        Assert.Equal(ControllerStatus.Healthy, restored.Status);
        Assert.Empty(restored.Faults);
        Assert.DoesNotContain(restored.Rooms.Single(room => room.Id == roomId).LightStrips,
            strip => strip.IsFaulted);
        Assert.False(restored.Rooms.Single(room => room.Id == roomId).SensorTriggered);
        Assert.False(restored.Rooms.Single(room => room.Id == roomId).Presence);
    }

    [Fact]
    public void MutationsAdvanceControllerRevision()
    {
        var simulator = new BuildingSimulator();
        var roomId = DeviceIds.Room(2, "office-a");
        var initial = simulator.GetController("controller-floor-2");

        Assert.NotNull(initial);
        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor(roomId, out var triggered));
        Assert.NotNull(triggered);
        Assert.Equal(initial.Revision + 1, triggered.Revision);

        Assert.True(simulator.ResetSensor(roomId, out var reset));
        Assert.Equal(triggered.Revision + 1, reset.Revision);
    }

    [Fact]
    public void FaultMutationsAdvanceRevisionAndResetClearsFaults()
    {
        var simulator = new BuildingSimulator();
        var stripId = DeviceIds.Light(1, "office-a", 1);
        var initial = simulator.GetController("controller-floor-1");

        Assert.NotNull(initial);
        Assert.True(simulator.IsRoomOwnedBy("controller-floor-1", DeviceIds.Room(1, "office-a")));
        Assert.False(simulator.IsRoomOwnedBy("controller-floor-1", DeviceIds.Room(2, "office-a")));
        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-1",
            new FaultRequest("light", stripId, "Test fault"), out var faulted));
        Assert.NotNull(faulted);
        Assert.Equal(initial.Revision + 1, faulted.Revision);

        Assert.True(simulator.ClearFault("controller-floor-1", faulted.Faults.Single().Id, out var restored));
        Assert.Equal(faulted.Revision + 1, restored.Revision);

        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-1",
            new FaultRequest("sensor", DeviceIds.Sensor(1, "office-b"), "Test sensor fault"), out _));
        var reset = simulator.ResetBuilding();
        Assert.All(reset, controller =>
        {
            Assert.Equal(ControllerStatus.Healthy, controller.Status);
            Assert.Empty(controller.Faults);
            Assert.All(controller.Rooms, room =>
            {
                Assert.False(room.Presence);
                Assert.False(room.SensorTriggered);
                Assert.All(room.LightStrips, strip =>
                {
                    Assert.False(strip.IsOn);
                    Assert.False(strip.IsFaulted);
                });
            });
        });
    }

    [Theory]
    [InlineData("sensor", "sensor-floor-1-office-a")]
    [InlineData("light", "light-floor-1-office-a-1")]
    [InlineData("controller", "controller-floor-1")]
    public void IndependentDeviceTargetsAreOwnedByCorrectController(string scope, string targetId)
    {
        var simulator = new BuildingSimulator();
        var request = new FaultRequest(scope, targetId, $"Test {scope} fault");

        Assert.True(simulator.IsFaultTargetOwnedBy("controller-floor-1", request));
        Assert.False(simulator.IsFaultTargetOwnedBy("controller-floor-2", request));
    }

    [Fact]
    public void FaultCanBeClearedByTargetIdentity()
    {
        var simulator = new BuildingSimulator();
        var sensorId = DeviceIds.Sensor(4, "office-a");
        Assert.Equal(FaultMutationResult.Added, simulator.AddFault("controller-floor-4",
            new FaultRequest("sensor", sensorId, "MQTT sensor fault"), out var faulted));
        Assert.NotNull(faulted);

        Assert.True(simulator.ClearFaultByTarget("controller-floor-4", sensorId, out var restored));
        Assert.Equal(ControllerStatus.Healthy, restored.Status);
        Assert.Empty(restored.Faults);
        Assert.False(simulator.ClearFaultByTarget("controller-floor-3", sensorId, out _));
    }

    [Fact]
    public void RandomOccupancyChoosesOneToTwoRoomsPerFloor()
    {
        var simulator = new BuildingSimulator();
        var occupied = simulator.SetRandomOccupancy(new Random(42));

        Assert.Equal(4, occupied.Count);
        Assert.All(occupied, controller =>
        {
            var occupiedRooms = controller.Rooms.Where(room => room.Presence).ToArray();
            Assert.InRange(occupiedRooms.Length, 1, 2);
            Assert.All(occupiedRooms, room =>
            {
                Assert.True(room.SensorTriggered);
                Assert.All(room.LightStrips, strip => Assert.True(strip.IsOn));
            });
            Assert.All(controller.Rooms.Where(room => !room.Presence), room =>
            {
                Assert.False(room.SensorTriggered);
                Assert.All(room.LightStrips, strip => Assert.False(strip.IsOn));
            });
        });
    }
}

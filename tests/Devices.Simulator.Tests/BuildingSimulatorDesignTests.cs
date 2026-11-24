public class BuildingSimulatorDesignTests
{
    [Fact]
    public void ActivationPreservesRetainedStateAndRemovesDeletedDevices()
    {
        var simulator = new BuildingSimulator();
        var first = Design(1, "room-a", "sensor-a", "light-a", "light-b");
        simulator.ActivateDesign(first);
        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor("room-a", out _));
        Assert.Equal(FaultMutationResult.Added,
            simulator.AddFault("controller-a", new FaultRequest("light", "light-a", "Fault"), out _));

        var changed = first with
        {
            Revision = 2,
            Floors = [first.Floors[0] with
            {
                Rooms = [first.Floors[0].Rooms[0] with
                {
                    Name = "Renamed",
                    Lights = [first.Floors[0].Rooms[0].Lights[0], new LightDesign("light-c", 4, 4, "controller-a")]
                }]
            }]
        };
        var controller = Assert.Single(simulator.ActivateDesign(changed));
        var room = Assert.Single(controller.Rooms);
        Assert.True(room.Presence);
        Assert.True(room.SensorTriggered);
        Assert.Equal("sensor-a", room.SensorId);
        Assert.True(room.LightStrips.Single(light => light.Id == "light-a").IsFaulted);
        Assert.True(room.LightStrips.Single(light => light.Id == "light-c").IsOn);
        Assert.Single(controller.Faults);
        Assert.Equal(2, simulator.GetControllerSnapshot().Revision);
        Assert.Throws<InvalidOperationException>(() => simulator.ActivateDesign(first));

        var replacement = Design(3, "room-new", "sensor-new", "light-new");
        var newRoom = Assert.Single(Assert.Single(simulator.ActivateDesign(replacement)).Rooms);
        Assert.False(newRoom.Presence);
        Assert.Empty(simulator.GetController("controller-a")!.Faults);
        Assert.Equal(SensorTriggerResult.RoomNotFound, simulator.TriggerSensor("room-a", out _));
        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor("room-new", out _));
    }

    [Fact]
    public void ReplacingSensorDoesNotTransferPresenceOrFaults()
    {
        var simulator = new BuildingSimulator();
        var first = Design(1, "room-a", "sensor-a", "light-a");
        simulator.ActivateDesign(first);
        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor("room-a", out _));
        var replacement = first with
        {
            Revision = 2,
            Floors = [first.Floors[0] with
            {
                Rooms = [first.Floors[0].Rooms[0] with { Sensor = new SensorDesign("sensor-b", 3, 3, "controller-a") }]
            }]
        };
        var room = Assert.Single(Assert.Single(simulator.ActivateDesign(replacement)).Rooms);
        Assert.False(room.Presence);
        Assert.False(room.LightStrips[0].IsOn);
        Assert.Equal(FaultMutationResult.InvalidTarget,
            simulator.AddFault("controller-a", new FaultRequest("sensor", "sensor-a", "Old"), out _));
        Assert.Equal(FaultMutationResult.Added,
            simulator.AddFault("controller-a", new FaultRequest("sensor", "sensor-b", "New"), out _));
    }

    [Fact]
    public void FailedActivationCommitLeavesRunningDesignUnchanged()
    {
        var simulator = new BuildingSimulator();
        simulator.ActivateDesign(Design(1, "room-a", "sensor-a", "light-a"));
        Assert.Throws<InvalidOperationException>(() =>
            simulator.ActivateDesign(Design(2, "room-b", "sensor-b", "light-b"),
                () => throw new InvalidOperationException("Storage failed")));
        Assert.Equal(1, simulator.GetControllerSnapshot().Revision);
        Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor("room-a", out _));
        Assert.Equal(SensorTriggerResult.RoomNotFound, simulator.TriggerSensor("room-b", out _));
    }

    [Fact]
    public void ActivationPreservesExistingLightStateWhenSensorIsFaulted()
    {
        var simulator = new BuildingSimulator();
        var design = Design(1, "room-a", "sensor-a", "light-a");
        simulator.ActivateDesign(design);
        simulator.TriggerSensor("room-a", out _);
        simulator.AddFault("controller-a", new FaultRequest("sensor", "sensor-a", "Fault"), out _);

        var room = Assert.Single(Assert.Single(simulator.ActivateDesign(design with { Revision = 2 })).Rooms);
        Assert.False(room.Presence);
        Assert.True(Assert.Single(room.LightStrips).IsOn);
        Assert.Equal(SensorTriggerResult.SensorFaulted, simulator.TriggerSensor("room-a", out _));
    }

    [Fact]
    public void MovingRetainedRoomBetweenControllersPreservesPresenceAndDeviceFaults()
    {
        var simulator = new BuildingSimulator();
        var first = Design(1, "room-a", "sensor-a", "light-a") with
        {
            Floors =
            [
                Design(1, "room-a", "sensor-a", "light-a").Floors[0],
                new FloorDesign("floor-b", 2, "controller-b", 1, 1, [])
            ]
        };
        simulator.ActivateDesign(first);
        simulator.TriggerSensor("room-a", out _);
        simulator.AddFault("controller-a", new FaultRequest("light", "light-a", "Fault"), out _);
        var room = first.Floors[0].Rooms[0];
        var moved = room with
        {
            Sensor = room.Sensor with { ControllerId = "controller-b" },
            Lights = room.Lights.Select(light => light with { ControllerId = "controller-b" }).ToArray()
        };
        simulator.ActivateDesign(first with
        {
            Revision = 2,
            Floors = [first.Floors[0] with { Rooms = [] }, first.Floors[1] with { Rooms = [moved] }]
        });
        var oldController = simulator.GetController("controller-a")!;
        var newController = simulator.GetController("controller-b")!;
        Assert.Empty(oldController.Faults);
        Assert.True(Assert.Single(newController.Rooms).Presence);
        Assert.Equal("light-a", Assert.Single(newController.Faults).TargetId);
        Assert.True(Assert.Single(newController.Rooms[0].LightStrips).IsFaulted);
        Assert.Equal(SensorTriggerResult.RoomNotFound,
            simulator.TriggerSensorForController("controller-a", "room-a", out _));
        Assert.False(simulator.ResetSensorForController("controller-a", "room-a", out _));
        Assert.True(simulator.GetController("controller-b")!.Rooms[0].Presence);
    }

    private static BuildingDesign Design(long revision, string roomId, string sensorId, params string[] lightIds) =>
        new(revision, 20, 20,
        [
            new FloorDesign("floor-a", 1, "controller-a", 1, 1,
            [
                new RoomDesign(roomId, "Office", 2, 2, 4, 4,
                    new SensorDesign(sensorId, 3, 3, "controller-a"), [],
                    lightIds.Select(id => new LightDesign(id, 4, 4, "controller-a")).ToArray())
            ])
        ]);
}

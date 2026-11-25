using Devices.Contracts;

public sealed partial class BuildingSimulator
{
    private long designRevision;
    private BuildingDesign? activeDesign;

    public BuildingControllerSnapshot GetControllerSnapshot()
    {
        lock (gate)
            return new BuildingControllerSnapshot(designRevision,
                controllers.Values.OrderBy(controller => controller.Floor).ToArray());
    }

    public BuildingView GetBuildingView()
    {
        lock (gate)
            return new BuildingView(activeDesign, controllers.Values.OrderBy(controller => controller.Floor).ToArray());
    }

    public IReadOnlyList<ControllerState> ActivateDesign(BuildingDesign design, Action? commit = null)
    {
        lock (gate)
        {
            if (activeDesign is not null && design.Revision < designRevision)
                throw new InvalidOperationException("Cannot activate an older building design.");
            if (activeDesign is not null && design.Revision == designRevision)
            {
                commit?.Invoke();
                return controllers.Values.OrderBy(controller => controller.Floor).ToArray();
            }
            var next = new List<ControllerState>();
            var previousControllers = controllers.Values.ToArray();
            var previousRooms = previousControllers
                .SelectMany(controller => controller.Rooms.Select(room => (Room: room, controller.Floor)))
                .ToDictionary(item => item.Room.Id, StringComparer.Ordinal);
            var previousFaults = previousControllers.SelectMany(controller => controller.Faults).ToArray();
            foreach (var floor in design.Floors.OrderBy(floor => floor.Number))
            {
                controllers.TryGetValue(floor.ControllerId, out var existing);
                var sensorIds = floor.Rooms.Select(room => room.Sensor.Id).ToHashSet(StringComparer.Ordinal);
                var lightIds = floor.Rooms.SelectMany(room => room.Lights).Select(light => light.Id)
                    .ToHashSet(StringComparer.Ordinal);
                var faults = previousFaults.Where(fault => fault.Scope switch
                {
                    "controller" => fault.TargetId == floor.ControllerId,
                    "sensor" => sensorIds.Contains(fault.TargetId),
                    "light" => lightIds.Contains(fault.TargetId),
                    _ => false
                }).ToArray();
                var rooms = floor.Rooms.Select(room =>
                {
                    var found = previousRooms.TryGetValue(room.Id, out var previous);
                    var sameSensor = found && SensorId(previous.Room, previous.Floor) == room.Sensor.Id;
                    var triggered = sameSensor && previous.Room.SensorTriggered &&
                        !faults.Any(fault => fault.Scope == "sensor" && fault.TargetId == room.Sensor.Id);
                    var lights = room.Lights.Select(light =>
                    {
                        var faulted = faults.Any(fault => fault.Scope == "light" && fault.TargetId == light.Id);
                        var previousLight = found ? previous.Room.LightStrips.FirstOrDefault(strip => strip.Id == light.Id) : null;
                        var isOn = sameSensor && previousLight is not null ? previousLight.IsOn : triggered;
                        return new LightStrip(light.Id, room.Id, isOn && !faulted, faulted);
                    }).ToArray();
                    return new RoomState(room.Id, room.Name, floor.ControllerId, triggered,
                        sameSensor && previous.Room.Presence, lights, room.Sensor.Id);
                }).ToArray();
                next.Add(new ControllerState(floor.ControllerId, floor.Number,
                    faults.Length == 0 ? ControllerStatus.Healthy : ControllerStatus.Faulted,
                    DateTimeOffset.UtcNow, rooms, faults, (existing?.Revision ?? -1) + 1));
            }

            commit?.Invoke();
            controllers.Clear();
            foreach (var controller in next)
                controllers[controller.Id] = controller;
            designRevision = design.Revision;
            activeDesign = design;
            return next;
        }
    }
}

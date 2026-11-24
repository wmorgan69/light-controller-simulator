using System.Collections.Concurrent;
using Devices.Contracts;

public sealed record FaultRequest(string Scope, string TargetId, string Description);

public enum SensorTriggerResult
{
    Triggered,
    RoomNotFound,
    SensorFaulted
}

public enum FaultMutationResult
{
    Added,
    ControllerNotFound,
    InvalidTarget,
    Duplicate
}

public sealed partial class BuildingSimulator
{
    private readonly object gate = new();
    private readonly ConcurrentDictionary<string, ControllerState> controllers = new(
        DeviceIds.CreateBuilding().ToDictionary(controller => controller.Id));

    public IReadOnlyList<ControllerState> GetControllers()
    {
        lock (gate)
            return controllers.Values.OrderBy(controller => controller.Floor).ToArray();
    }

    public ControllerState? GetController(string controllerId)
    {
        lock (gate)
            return controllers.TryGetValue(controllerId, out var controller) ? controller : null;
    }

    public SensorTriggerResult TriggerSensor(string roomId, out ControllerState? controller)
    {
        lock (gate)
        {
            controller = null;
            foreach (var existing in controllers.Values)
            {
                var room = existing.Rooms.FirstOrDefault(candidate => candidate.Id == roomId);
                if (room is null) continue;
                if (existing.Faults.Any(fault => fault.Scope == "sensor" && fault.TargetId == SensorId(room, existing.Floor)))
                {
                    controller = existing;
                    return SensorTriggerResult.SensorFaulted;
                }

                var triggered = room with
                {
                    SensorTriggered = true,
                    Presence = true,
                    LightStrips = room.LightStrips.Select(strip => strip with { IsOn = !strip.IsFaulted }).ToArray()
                };
                var rooms = existing.Rooms.Select(candidate => candidate.Id == roomId ? triggered : candidate).ToArray();
                controller = existing with
                {
                    Status = existing.Faults.Count == 0 ? ControllerStatus.Healthy : ControllerStatus.Faulted,
                    LastSeen = DateTimeOffset.UtcNow,
                    Rooms = rooms,
                    Revision = existing.Revision + 1
                };
                controllers[existing.Id] = controller;
                return SensorTriggerResult.Triggered;
            }
            return SensorTriggerResult.RoomNotFound;
        }
    }

    public bool ResetSensor(string roomId, out ControllerState controller)
    {
        lock (gate)
        {
            controller = null!;
            foreach (var existing in controllers.Values)
            {
                var room = existing.Rooms.FirstOrDefault(candidate => candidate.Id == roomId);
                if (room is null) continue;

                var reset = room with
                {
                    Presence = false,
                    SensorTriggered = false,
                    LightStrips = room.LightStrips
                        .Select(strip => strip with { IsOn = false })
                        .ToArray()
                };
                var rooms = existing.Rooms.Select(candidate => candidate.Id == roomId ? reset : candidate).ToArray();
                controller = existing with
                {
                    LastSeen = DateTimeOffset.UtcNow,
                    Rooms = rooms,
                    Revision = existing.Revision + 1
                };
                controllers[existing.Id] = controller;
                return true;
            }
            return false;
        }
    }

    public FaultMutationResult AddFault(string deviceId, FaultRequest request, out ControllerState? controller)
    {
        lock (gate)
        {
            if (!TryFindController(deviceId, out var existing))
            {
                controller = null;
                return FaultMutationResult.ControllerNotFound;
            }
            if (!IsValidFaultTarget(existing, request))
            {
                controller = existing;
                return FaultMutationResult.InvalidTarget;
            }
            if (existing.Faults.Any(fault => fault.Scope == request.Scope && fault.TargetId == request.TargetId))
            {
                controller = existing;
                return FaultMutationResult.Duplicate;
            }

            var fault = new ControllerFault($"fault-{Guid.NewGuid():N}", request.Scope, request.TargetId, request.Description);
            var faults = existing.Faults.Append(fault).ToArray();
            var rooms = existing.Rooms.Select(room => ApplyRoomFault(room, fault, existing.Floor)).ToArray();
            controller = existing with
            {
                Status = ControllerStatus.Faulted,
                LastSeen = DateTimeOffset.UtcNow,
                Rooms = rooms,
                Faults = faults,
                Revision = existing.Revision + 1
            };
            controllers[existing.Id] = controller;
            return FaultMutationResult.Added;
        }
    }

    public bool ClearFault(string deviceId, string faultId, out ControllerState controller)
    {
        lock (gate)
        {
            if (!TryFindController(deviceId, out var existing))
            {
                controller = null!;
                return false;
            }

            var fault = existing.Faults.FirstOrDefault(candidate => candidate.Id == faultId);
            if (fault is null)
            {
                controller = existing;
                return false;
            }

            var faults = existing.Faults.Where(candidate => candidate.Id != faultId).ToArray();
            var rooms = existing.Rooms.Select(room => RestoreRoomFault(room, fault, existing.Floor)).ToArray();
            controller = existing with
            {
                Status = faults.Length == 0 ? ControllerStatus.Healthy : ControllerStatus.Faulted,
                LastSeen = DateTimeOffset.UtcNow,
                Rooms = rooms,
                Faults = faults,
                Revision = existing.Revision + 1
            };
            controllers[existing.Id] = controller;
            return true;
        }
    }

    public bool ClearFaultByTarget(string controllerId, string targetId, out ControllerState controller)
    {
        lock (gate)
        {
            if (!controllers.TryGetValue(controllerId, out var existing))
            {
                controller = null!;
                return false;
            }
            var fault = existing.Faults.FirstOrDefault(candidate =>
                candidate.TargetId == targetId || candidate.Id == targetId);
            if (fault is null)
            {
                controller = existing;
                return false;
            }
            return ClearFault(controllerId, fault.Id, out controller);
        }
    }

    public bool IsRoomOwnedBy(string controllerId, string roomId)
    {
        lock (gate)
        {
            return controllers.TryGetValue(controllerId, out var controller) &&
                controller.Rooms.Any(room => room.Id == roomId);
        }
    }

    public SensorTriggerResult TriggerSensorForController(string controllerId, string roomId, out ControllerState? controller)
    {
        lock (gate)
        {
            if (!IsRoomOwnedBy(controllerId, roomId))
            {
                controller = null;
                return SensorTriggerResult.RoomNotFound;
            }
            return TriggerSensor(roomId, out controller);
        }
    }

    public bool ResetSensorForController(string controllerId, string roomId, out ControllerState controller)
    {
        lock (gate)
        {
            if (!IsRoomOwnedBy(controllerId, roomId))
            {
                controller = null!;
                return false;
            }
            return ResetSensor(roomId, out controller);
        }
    }

    public bool IsFaultTargetOwnedBy(string controllerId, FaultRequest request)
    {
        lock (gate)
        {
            return controllers.TryGetValue(controllerId, out var controller) &&
                IsValidFaultTarget(controller, request);
        }
    }

    public IReadOnlyList<ControllerState> ResetBuilding()
    {
        lock (gate)
        {
            var resetControllers = controllers.Values
                .Select(existing =>
                {
                    var rooms = existing.Rooms.Select(room => room with
                    {
                        Presence = false,
                        SensorTriggered = false,
                        LightStrips = room.LightStrips
                            .Select(strip => strip with { IsOn = false, IsFaulted = false })
                            .ToArray()
                    }).ToArray();
                    var reset = existing with
                    {
                        Status = ControllerStatus.Healthy,
                        LastSeen = DateTimeOffset.UtcNow,
                        Rooms = rooms,
                        Faults = Array.Empty<ControllerFault>(),
                        Revision = existing.Revision + 1
                    };
                    controllers[existing.Id] = reset;
                    return reset;
                })
                .OrderBy(controller => controller.Floor)
                .ToArray();
            return resetControllers;
        }
    }

    public IReadOnlyList<ControllerState> SetRandomOccupancy() =>
        SetRandomOccupancy(Random.Shared);

    public IReadOnlyList<ControllerState> SetRandomOccupancy(Random random)
    {
        lock (gate)
        {
            var occupiedControllers = controllers.Values
                .Select(existing =>
                {
                    var roomIndices = Enumerable.Range(0, existing.Rooms.Count).ToArray();
                    for (var index = roomIndices.Length - 1; index > 0; index--)
                    {
                        var swapIndex = random.Next(index + 1);
                        (roomIndices[index], roomIndices[swapIndex]) =
                            (roomIndices[swapIndex], roomIndices[index]);
                    }

                    var occupiedCount = random.Next(1, 3);
                    var occupiedIds = roomIndices.Take(occupiedCount)
                        .Select(index => existing.Rooms[index].Id)
                        .ToHashSet(StringComparer.Ordinal);

                    var rooms = existing.Rooms.Select(room =>
                    {
                        var occupied = occupiedIds.Contains(room.Id);
                        return room with
                        {
                            Presence = occupied,
                            SensorTriggered = occupied,
                            LightStrips = room.LightStrips
                                .Select(strip => strip with
                                {
                                    IsOn = occupied,
                                    IsFaulted = false
                                })
                                .ToArray()
                        };
                    }).ToArray();
                    var occupiedController = existing with
                    {
                        Status = ControllerStatus.Healthy,
                        LastSeen = DateTimeOffset.UtcNow,
                        Rooms = rooms,
                        Faults = Array.Empty<ControllerFault>(),
                        Revision = existing.Revision + 1
                    };
                    controllers[existing.Id] = occupiedController;
                    return occupiedController;
                })
                .OrderBy(controller => controller.Floor)
                .ToArray();
            return occupiedControllers;
        }
    }

    private bool TryFindController(string deviceId, out ControllerState controller)
    {
        controller = null!;
        if (controllers.TryGetValue(deviceId, out var found))
        {
            controller = found;
            return true;
        }
        foreach (var candidate in controllers.Values)
        {
            if (candidate.Rooms.Any(room => room.Id == deviceId || room.LightStrips.Any(strip => strip.Id == deviceId)))
            {
                controller = candidate;
                return true;
            }
        }
        return false;
    }

    private static RoomState ApplyRoomFault(RoomState room, ControllerFault fault, int floor)
    {
        if (fault.Scope == "sensor" && fault.TargetId == SensorId(room, floor))
            return room with { Presence = false, SensorTriggered = false };
        if (fault.Scope == "light" && room.LightStrips.Any(strip => strip.Id == fault.TargetId))
        {
            var strips = room.LightStrips.Select(strip => strip.Id == fault.TargetId
                ? strip with { IsFaulted = true, IsOn = false }
                : strip).ToArray();
            return room with { LightStrips = strips };
        }
        return room;
    }

    private static RoomState RestoreRoomFault(RoomState room, ControllerFault fault, int floor)
    {
        if (fault.Scope == "sensor" && fault.TargetId == SensorId(room, floor))
            return room;
        if (fault.Scope == "light" && room.LightStrips.Any(strip => strip.Id == fault.TargetId))
        {
            var strips = room.LightStrips.Select(strip => strip.Id == fault.TargetId
                ? strip with { IsFaulted = false, IsOn = room.SensorTriggered }
                : strip).ToArray();
            return room with { LightStrips = strips };
        }
        return room;
    }

    private static string SensorId(RoomState room, int floor) =>
        room.SensorId ?? $"sensor-floor-{floor}-{room.Id[($"floor-{floor}-").Length..]}";

    private static bool IsValidFaultTarget(ControllerState controller, FaultRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Description) || string.IsNullOrWhiteSpace(request.TargetId)) return false;
        return request.Scope switch
        {
            "sensor" => controller.Rooms.Any(room => SensorId(room, controller.Floor) == request.TargetId),
            "light" => controller.Rooms.SelectMany(room => room.LightStrips).Any(strip => strip.Id == request.TargetId),
            "controller" => controller.Id == request.TargetId,
            _ => false
        };
    }
}


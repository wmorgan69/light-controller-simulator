using Devices.Contracts;

public sealed record BuildingDesign(long Revision, decimal Width, decimal Depth, IReadOnlyList<FloorDesign> Floors);
public sealed record FloorDesign(string Id, int Number, string ControllerId, decimal ControllerX, decimal ControllerZ, IReadOnlyList<RoomDesign> Rooms);
public sealed record RoomDesign(string Id, string Name, decimal X, decimal Z, decimal Width, decimal Depth, SensorDesign Sensor, IReadOnlyList<DoorDesign> Doors, IReadOnlyList<LightDesign> Lights);
public sealed record SensorDesign(string Id, decimal X, decimal Z, string? ControllerId);
public sealed record LightDesign(string Id, decimal X, decimal Z, string? ControllerId);
public sealed record DoorDesign(string Id, decimal X, decimal Z);

public sealed record BuildingDesignValidationError(string Path, string Message);

public static class BuildingDesignValidator
{
    public static IReadOnlyList<BuildingDesignValidationError> ValidateStructure(BuildingDesign? design)
    {
        const int maxEntities = 10_000;
        var errors = new List<BuildingDesignValidationError>();
        void Error(string path, string message) => errors.Add(new(path, message));
        if (design is null) { Error("design", "A design is required."); return errors; }
        if (design.Revision < 0) Error("revision", "Revision cannot be negative.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        bool SafeId(string? id) => !string.IsNullOrEmpty(id) && id.Length <= 128 &&
            id.All(c => c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-' or '_');
        void Id(string? id, string path)
        {
            if (!SafeId(id)) Error(path, "ID must contain 1–128 ASCII letters, digits, hyphens or underscores.");
            else if (!ids.Add(id!)) Error(path, "ID must be unique across the design.");
        }
        void Reference(string? id, string path)
        {
            if (id is not null && !SafeId(id)) Error(path, "Controller ID must be a safe ID or null.");
        }
        if (design.Floors is null) { Error("floors", "Floors are required."); return errors; }
        if (design.Floors.Count > 100) { Error("floors", "A design may contain at most 100 floors."); return errors; }
        long count = 0;
        for (var fi = 0; fi < design.Floors.Count; fi++)
        {
            var floor = design.Floors[fi];
            var fp = $"floors[{fi}]";
            if (floor is null) { Error(fp, "Floor is required."); continue; }
            count += 2;
            Id(floor.Id, fp + ".id");
            Id(floor.ControllerId, fp + ".controllerId");
            if (floor.Rooms is null) { Error(fp + ".rooms", "Rooms are required."); continue; }
            if (count + 2L * floor.Rooms.Count > maxEntities) { Error(fp + ".rooms", "Design contains too many entities."); return errors; }
            for (var ri = 0; ri < floor.Rooms.Count; ri++)
            {
                var room = floor.Rooms[ri];
                var rp = $"{fp}.rooms[{ri}]";
                if (room is null) { Error(rp, "Room is required."); continue; }
                count += 2;
                Id(room.Id, rp + ".id");
                if (room.Name is null || room.Name.Length > 256) Error(rp + ".name", "Room name must be a string of at most 256 characters.");
                if (room.Sensor is null) Error(rp + ".sensor", "A sensor is required.");
                else
                {
                    Id(room.Sensor.Id, rp + ".sensor.id");
                    Reference(room.Sensor.ControllerId, rp + ".sensor.controllerId");
                }
                if (room.Doors is null) Error(rp + ".doors", "Doors are required.");
                if (room.Lights is null) Error(rp + ".lights", "Lights are required.");
                count += (long)(room.Doors?.Count ?? 0) + (room.Lights?.Count ?? 0);
                if (count > maxEntities) { Error(rp, "Design contains too many entities."); return errors; }
                for (var di = 0; di < (room.Doors?.Count ?? 0); di++)
                {
                    var door = room.Doors![di];
                    var dp = $"{rp}.doors[{di}]";
                    if (door is null) Error(dp, "Door is required.");
                    else Id(door.Id, dp + ".id");
                }
                for (var li = 0; li < (room.Lights?.Count ?? 0); li++)
                {
                    var light = room.Lights![li];
                    var lp = $"{rp}.lights[{li}]";
                    if (light is null) { Error(lp, "Light is required."); continue; }
                    Id(light.Id, lp + ".id");
                    Reference(light.ControllerId, lp + ".controllerId");
                }
            }
        }
        return errors;
    }

    public static IReadOnlyList<BuildingDesignValidationError> ValidateForSave(BuildingDesign? design)
    {
        var structural = ValidateStructure(design);
        return structural.Count == 0 ? Validate(design, true) : structural;
    }

    private static IReadOnlyList<BuildingDesignValidationError> Validate(BuildingDesign? design, bool requireConnections)
    {
        var errors = new List<BuildingDesignValidationError>();
        void Error(string path, string message) => errors.Add(new(path, message));
        if (design is null) { Error("design", "A design is required."); return errors; }
        bool Grid(decimal value) => value % 0.5m == 0;
        bool Dimension(decimal value) => value >= 2 && value <= 100 && Grid(value);
        if (design.Revision < 0) Error("revision", "Revision cannot be negative.");
        if (!Dimension(design.Width)) Error("width", "Width must be 2–100 metres on the 0.5 metre grid.");
        if (!Dimension(design.Depth)) Error("depth", "Depth must be 2–100 metres on the 0.5 metre grid.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        void Id(string? id, string path)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 128 ||
                id.Any(c => !(c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-' or '_')))
                Error(path, "ID must contain 1–128 ASCII letters, digits, hyphens or underscores.");
            else if (!ids.Add(id)) Error(path, "ID must be unique across the design.");
        }
        void Point(decimal x, decimal z, decimal minX, decimal minZ, decimal maxX, decimal maxZ, string path)
        {
            if (!Grid(x) || !Grid(z) || x < minX || x > maxX || z < minZ || z > maxZ)
                Error(path, "Position must be on the 0.5 metre grid and inside its bounds.");
        }
        void Connection(string? controller, string expected, string path)
        {
            if (controller is null && !requireConnections) return;
            if (controller != expected || string.IsNullOrEmpty(controller))
                Error(path, "Connect the device to its own floor controller.");
        }
        if (design.Floors is null) { Error("floors", "Floors are required."); return errors; }
        if (design.Floors.Count is < 1 or > 10) Error("floors", "A building must have 1–10 floors.");
        var numbers = new HashSet<int>();
        for (var fi = 0; fi < design.Floors.Count; fi++)
        {
            var floor = design.Floors[fi];
            var fp = $"floors[{fi}]";
            if (floor is null) { Error(fp, "Floor is required."); continue; }
            Id(floor.Id, fp + ".id");
            Id(floor.ControllerId, fp + ".controllerId");
            if (floor.Number < 1 || floor.Number > design.Floors.Count || !numbers.Add(floor.Number))
                Error(fp + ".number", "Floor numbers must be unique and contiguous from 1.");
            Point(floor.ControllerX, floor.ControllerZ, 0, 0, design.Width, design.Depth, fp + ".controller");
            if (floor.Rooms is null) { Error(fp + ".rooms", "Rooms are required."); continue; }
            var rectangles = new List<(decimal X, decimal Z, decimal Right, decimal Bottom)>();
            for (var ri = 0; ri < floor.Rooms.Count; ri++)
            {
                var room = floor.Rooms[ri];
                var rp = $"{fp}.rooms[{ri}]";
                if (room is null) { Error(rp, "Room is required."); continue; }
                Id(room.Id, rp + ".id");
                if (string.IsNullOrWhiteSpace(room.Name)) Error(rp + ".name", "Room name is required.");
                var validRect = room.X >= 0 && room.Z >= 0 && Grid(room.X) && Grid(room.Z) &&
                    room.Width >= 1 && room.Depth >= 1 && Grid(room.Width) && Grid(room.Depth) &&
                    room.X <= design.Width && room.Z <= design.Depth &&
                    room.Width <= design.Width - room.X && room.Depth <= design.Depth - room.Z;
                if (!validRect) Error(rp, "Room must be at least 1 metre, on the grid, and within the building.");
                if (validRect)
                {
                    var right = room.X + room.Width;
                    var bottom = room.Z + room.Depth;
                    if (rectangles.Any(r => room.X < r.Right && right > r.X && room.Z < r.Bottom && bottom > r.Z))
                        Error(rp, "Rooms on the same floor cannot overlap.");
                    rectangles.Add((room.X, room.Z, right, bottom));
                }
                void RoomPoint(decimal x, decimal z, string path, bool boundary)
                {
                    if (!validRect) return;
                    Point(x, z, room.X, room.Z, room.X + room.Width, room.Z + room.Depth, path);
                    if (boundary && x != room.X && x != room.X + room.Width && z != room.Z && z != room.Z + room.Depth)
                        Error(path, "Door must lie on the room boundary.");
                }
                if (room.Sensor is null) Error(rp + ".sensor", "A sensor is required.");
                else
                {
                    Id(room.Sensor.Id, rp + ".sensor.id");
                    RoomPoint(room.Sensor.X, room.Sensor.Z, rp + ".sensor", false);
                    Connection(room.Sensor.ControllerId, floor.ControllerId, rp + ".sensor.controllerId");
                }
                if (room.Doors is null) Error(rp + ".doors", "Doors are required.");
                else for (var di = 0; di < room.Doors.Count; di++)
                {
                    var door = room.Doors[di];
                    var dp = $"{rp}.doors[{di}]";
                    if (door is null) { Error(dp, "Door is required."); continue; }
                    Id(door.Id, dp + ".id");
                    RoomPoint(door.X, door.Z, dp, true);
                }
                if (room.Lights is null) Error(rp + ".lights", "Lights are required.");
                else for (var li = 0; li < room.Lights.Count; li++)
                {
                    var light = room.Lights[li];
                    var lp = $"{rp}.lights[{li}]";
                    if (light is null) { Error(lp, "Light is required."); continue; }
                    Id(light.Id, lp + ".id");
                    RoomPoint(light.X, light.Z, lp, false);
                    Connection(light.ControllerId, floor.ControllerId, lp + ".controllerId");
                }
            }
        }
        return errors;
    }
}

public static class BuildingDesignSeed
{
    private static decimal Grid(decimal value) => decimal.Round(value * 2, 0, MidpointRounding.AwayFromZero) / 2;

    public static BuildingDesign Create()
    {
        var floors = DeviceIds.CreateBuilding().Select(controller =>
        {
            var rooms = controller.Rooms.Select(room =>
            {
                var key = room.Id[$"floor-{controller.Floor}-".Length..];
                var (centerX, centerZ, originalWidth, originalDepth, doorSide, doorCenter) = (controller.Floor, key) switch
                {
                    (2, "main") => (-1.125m, 1.075m, 7.25m, 4.95m, "front", 0.4m),
                    (4, "main") => (0m, 1.075m, 9.5m, 4.95m, "front", 0.4m),
                    (_, "main") => (-2.4m, 0m, 4.7m, 7.1m, "right", -1.7m),
                    (2, "office-a") => (3.8m, 0m, 2.35m, 2.8m, "front", 3.8m),
                    (_, "office-a") => (1.25m, 0m, 2.35m, 2.8m, "front", 1.25m),
                    (_, "office-b") => (3.8m, 0m, 2.35m, 2.8m, "front", 3.8m),
                    _ => throw new InvalidOperationException($"Unexpected seed room {room.Id}.")
                };
                var x = Grid(10 + centerX - originalWidth / 2);
                var z = Grid(10 + centerZ - originalDepth / 2);
                var right = Grid(10 + centerX + originalWidth / 2);
                var bottom = Grid(10 + centerZ + originalDepth / 2);
                var count = room.LightStrips.Count;
                var columns = count is 8 or 12 ? count / 2 : 0;
                var lights = room.LightStrips.Select((light, i) =>
                {
                    var dx = columns > 0 ? (i % columns - (columns - 1) / 2m) * (originalWidth - 1.5m) / (columns - 1)
                        : count == 6 ? (i % 3 - 1) * 1.3m : 0m;
                    var dz = columns > 0 ? (i < columns ? -1 : 1) * originalDepth * 0.24m
                        : count == 6 ? (i < 3 ? -1.6m : 1.6m) : 0m;
                    return new LightDesign(light.Id, Grid(10 + centerX + dx), Grid(10 + centerZ + dz), controller.Id);
                }).ToArray();
                var door = doorSide == "right"
                    ? new DoorDesign($"door-{room.Id}-1", right, Grid(10 + doorCenter))
                    : new DoorDesign($"door-{room.Id}-1", Grid(10 + doorCenter), z);
                return new RoomDesign(room.Id, room.Name, x, z, right - x, bottom - z,
                    new SensorDesign(DeviceIds.Sensor(controller.Floor, key), Grid(10 + centerX + 0.22m),
                        Grid(10 + centerZ + (count >= 4 ? 0 : 0.9m)), controller.Id),
                    [door], lights);
            }).ToArray();
            return new FloorDesign($"floor-{controller.Floor}", controller.Floor, controller.Id, 5.5m, 6.5m, rooms);
        }).ToArray();
        return new BuildingDesign(1, 20, 20, floors);
    }
}

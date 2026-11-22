namespace Devices.Contracts;

public static class DeviceIds
{
    public static string Controller(int floor) => $"controller-floor-{floor}";
    public static string Room(int floor, string room) => $"floor-{floor}-{room}";
    public static string Sensor(int floor, string room) => $"sensor-floor-{floor}-{room}";
    public static string Light(int floor, string room, int index) => $"light-floor-{floor}-{room}-{index}";

    public static IEnumerable<ControllerState> CreateBuilding()
    {
        for (var floor = 1; floor <= 4; floor++)
        {
            var rooms = new List<RoomState>
            {
                CreateRoom(floor, "main", "Main room", 4),
                CreateRoom(floor, "office-a", "Office A", 1),
                CreateRoom(floor, "office-b", "Office B", 1)
            };
            yield return new ControllerState(Controller(floor), floor, ControllerStatus.Healthy, DateTimeOffset.UtcNow, rooms, Array.Empty<ControllerFault>());
        }
    }

    private static RoomState CreateRoom(int floor, string roomId, string name, int stripCount)
    {
        var strips = Enumerable.Range(1, stripCount)
            .Select(index => new LightStrip(Light(floor, roomId, index), Room(floor, roomId), false, false))
            .ToArray();
        return new RoomState(Room(floor, roomId), name, Controller(floor), false, false, strips);
    }
}

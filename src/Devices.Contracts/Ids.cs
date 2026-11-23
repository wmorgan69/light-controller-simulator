using System.Globalization;
using System.Resources;

namespace Devices.Contracts;

public static class DeviceIds
{
    private static readonly ResourceManager RoomNames = new("Devices.Contracts.RoomNames", typeof(DeviceIds).Assembly);

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
                CreateRoom(floor, "main", floor switch
                {
                    1 => RoomName("OpenWorkspace"),
                    2 => RoomName("Boardroom"),
                    3 => RoomName("CollaborationSpace"),
                    4 => RoomName("TheForum"),
                    _ => throw new InvalidOperationException($"Unexpected floor {floor}.")
                }, floor switch { 2 => 8, 4 => 12, _ => 6 })
            };
            if (floor != 4)
                rooms.Add(CreateRoom(floor, "office-a", floor switch
                {
                    1 => RoomName("ReceptionOffice"),
                    2 => RoomName("MeetingOffice"),
                    3 => RoomName("ProjectOffice"),
                    _ => throw new InvalidOperationException($"Unexpected floor {floor}.")
                }, 1));
            if (floor is 1 or 3)
                rooms.Add(CreateRoom(floor, "office-b", RoomName(floor == 1 ? "SupportOffice" : "FocusOffice"), 1));
            yield return new ControllerState(Controller(floor), floor, ControllerStatus.Healthy, DateTimeOffset.UtcNow, rooms, Array.Empty<ControllerFault>());
        }
    }

    private static string RoomName(string key) =>
        RoomNames.GetString(key, CultureInfo.InvariantCulture)
        ?? throw new MissingManifestResourceException($"Room name resource '{key}' is missing.");

    private static RoomState CreateRoom(int floor, string roomId, string name, int stripCount)
    {
        var strips = Enumerable.Range(1, stripCount)
            .Select(index => new LightStrip(Light(floor, roomId, index), Room(floor, roomId), false, false))
            .ToArray();
        return new RoomState(Room(floor, roomId), name, Controller(floor), false, false, strips);
    }
}

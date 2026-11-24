using Devices.Contracts;

public sealed class MqttCommandRoutingTests
{
    [Fact]
    public void AcceptsMatchingControllerAndSingleLevelCommandId()
    {
        Assert.True(MqttCommandRouting.IsValid("building/controllers/controller-a/commands", Command("controller-a", "cmd-1")));
    }

    [Theory]
    [InlineData("building/controllers/controller-a/commands", "controller-b", "cmd-1")]
    [InlineData("building/controllers/controller-a/commands", "controller-a", "other/ack")]
    [InlineData("building/controllers/controller-a/commands", "controller-a", "#")]
    [InlineData("building/controllers/controller-a/commands", "controller-a", "+")]
    [InlineData("building//controllers/controller-a/commands", "controller-a", "cmd-1")]
    [InlineData("building/controllers/controller-a/commands/extra", "controller-a", "cmd-1")]
    public void RejectsMismatchedOrUnsafeRouting(string topic, string controllerId, string commandId)
    {
        Assert.False(MqttCommandRouting.IsValid(topic, Command(controllerId, commandId)));
    }

    [Fact]
    public void RejectsOversizedCommandId()
    {
        Assert.False(MqttCommandRouting.IsValid("building/controllers/controller-a/commands", Command("controller-a", new string('a', 129))));
    }

    private static DeviceCommand Command(string controllerId, string commandId) =>
        new(commandId, controllerId, "trigger", "room-a", null, null, null, DateTimeOffset.UtcNow);
}

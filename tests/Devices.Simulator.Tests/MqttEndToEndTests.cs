using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using Devices.Contracts;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MQTTnet;
using Xunit.Sdk;

public sealed class MqttEndToEndTests
{
    [LocalMosquittoFact]
    public async Task PublishedStateIsIngestedAndRemovedControllerRetainedStateIsCleared()
    {
        await using var broker = await LocalMqttBroker.StartOrSkipAsync();
        ControlTestDatabase.Reset();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Mqtt:Host"] = "127.0.0.1",
            ["Mqtt:Port"] = broker.Port.ToString(),
            ["ConnectionStrings:Control"] = ControlTestDatabase.ConnectionString,
            ["ConnectionStrings:Telemetry"] = SimulatorTelemetryTestDatabase.ConnectionString,
            ["Telemetry:SimulatorBaseUrl"] = "http://127.0.0.1:1"
        }).Build();
        SimulatorTelemetryTestDatabase.Reset(configuration);
        var designStore = new BuildingDesignStore(ControlTestDatabase.ConnectionString);
        var simulator = new BuildingSimulator();
        var publisher = new MqttTelemetryPublisher(NullLogger<MqttTelemetryPublisher>.Instance,
            configuration, simulator, designStore);
        var editor = new BuildingEditorService(designStore, simulator, publisher,
            NullLogger<BuildingEditorService>.Instance);
        var telemetryStore = new TelemetryStore(configuration, NullLogger<TelemetryStore>.Instance);
        var subscriber = new TelemetrySubscriber(NullLogger<TelemetrySubscriber>.Instance,
            configuration, telemetryStore);

        try
        {
            await subscriber.StartAsync(CancellationToken.None);
            Assert.True(subscriber.Status.MqttConnected, subscriber.Status.Message);
            await publisher.StartAsync(CancellationToken.None);
            await WaitUntilAsync(() => publisher.Status.MqttConnected, "Simulator did not connect to the broker.");

            var initialControllers = simulator.GetControllers();
            await WaitUntilAsync(() => telemetryStore.GetSnapshot().Count == initialControllers.Count,
                "Instrumentation did not ingest the simulator's retained controller states.");

            var changedController = initialControllers[0];
            var room = changedController.Rooms[0];
            Assert.Equal(SensorTriggerResult.Triggered, simulator.TriggerSensor(room.Id, out var triggered));
            await publisher.PublishAsync(triggered!);
            await WaitUntilAsync(
                () => telemetryStore.GetController(changedController.Id)?.Rooms
                    .Single(candidate => candidate.Id == room.Id).SensorTriggered == true,
                "Instrumentation did not ingest the published sensor state.");

            var state = editor.Read();
            var removedFloor = state.Design.Floors.OrderBy(floor => floor.Number).Last();
            var reducedDesign = state.Design with
            {
                Floors = state.Design.Floors.Where(floor => floor.Id != removedFloor.Id).ToArray()
            };
            var removedControllerId = removedFloor.ControllerId;
            var topic = $"building/controllers/{removedControllerId}/telemetry";
            Assert.NotEmpty(await ReadRetainedPayloadsAsync(broker.Port, topic));

            var save = editor.Save(new BuildingEditorWriteRequest(state.EditRevision, reducedDesign));
            Assert.Equal(200, ((IStatusCodeHttpResult)save).StatusCode);
            Assert.True(telemetryStore.ApplySnapshot(simulator.GetControllerSnapshot()));
            Assert.Null(telemetryStore.GetController(removedControllerId));

            publisher.RequestCleanup();
            await WaitUntilAsync(
                () => editor.Read().Cleanup.Single(item => item.ControllerId == removedControllerId).Status
                    == BuildingDesignCleanupStatus.Completed,
                "The simulator did not complete retained-state cleanup.");
            Assert.Empty(await ReadRetainedPayloadsAsync(broker.Port, topic));
            Assert.Contains(telemetryStore.GetEvents(), item => item.ControllerId == removedControllerId);
        }
        finally
        {
            await publisher.StopAsync(CancellationToken.None);
            await subscriber.StopAsync(CancellationToken.None);
        }
    }

    private static async Task WaitUntilAsync(Func<bool> condition, string failureMessage)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!condition())
        {
            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(25), timeout.Token);
            }
            catch (OperationCanceledException)
            {
                throw new XunitException(failureMessage);
            }
        }
    }

    private static async Task<IReadOnlyList<string>> ReadRetainedPayloadsAsync(int port, string topic)
    {
        var client = new MqttClientFactory().CreateMqttClient();
        var payloads = new ConcurrentQueue<string>();
        var barrierPayload = $"mqtt-read-barrier-{Guid.NewGuid():N}";
        var barrierReceived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        client.ApplicationMessageReceivedAsync += args =>
        {
            var payload = Encoding.UTF8.GetString(args.ApplicationMessage.Payload);
            if (payload == barrierPayload)
                barrierReceived.TrySetResult();
            else
                payloads.Enqueue(payload);
            return Task.CompletedTask;
        };
        try
        {
            await client.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
            await client.SubscribeAsync(topic);
            await client.PublishAsync(new MqttApplicationMessageBuilder()
                .WithTopic(topic)
                .WithPayload(barrierPayload)
                .Build());
            await barrierReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));
            return payloads.Where(payload => payload.Length > 0).ToArray();
        }
        finally
        {
            if (client.IsConnected)
                await client.DisconnectAsync();
            client.Dispose();
        }
    }

    private sealed class LocalMqttBroker : IAsyncDisposable
    {
        private readonly string containerName;

        private LocalMqttBroker(string containerName, int port)
        {
            this.containerName = containerName;
            Port = port;
        }

        public int Port { get; }

        public static async Task<LocalMqttBroker> StartOrSkipAsync()
        {
            (int ExitCode, string Output, string Error) image;
            try
            {
                image = await RunDockerAsync("image", "inspect", "eclipse-mosquitto:2");
            }
            catch (Win32Exception exception)
            {
                throw new InvalidOperationException("Docker became unavailable after test discovery.", exception);
            }

            if (image.ExitCode != 0)
                throw new InvalidOperationException("The local eclipse-mosquitto:2 image became unavailable after test discovery.");

            var name = $"devices-mqtt-test-{Guid.NewGuid():N}";
            var started = await RunDockerAsync("run", "--pull=never", "--detach", "--rm", "--name", name,
                "--publish", "127.0.0.1::1883", "--entrypoint", "/bin/sh", "eclipse-mosquitto:2", "-c",
                "printf 'listener 1883 0.0.0.0\\nallow_anonymous true\\n' > /mosquitto/config/test.conf && exec mosquitto -c /mosquitto/config/test.conf -v");
            if (started.ExitCode != 0)
                throw new InvalidOperationException($"Could not start the local MQTT test broker: {started.Error}");

            try
            {
                var portResult = await RunDockerAsync("port", name, "1883/tcp");
                if (portResult.ExitCode != 0)
                    throw new InvalidOperationException($"Could not find the local MQTT test broker port: {portResult.Error}");
                var portText = portResult.Output.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries)
                    .Select(line => line[(line.LastIndexOf(':') + 1)..].Trim())
                    .FirstOrDefault(value => int.TryParse(value, out _));
                if (!int.TryParse(portText, out var port))
                    throw new InvalidOperationException("Docker did not report a host port for the MQTT test broker.");

                var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
                while (DateTime.UtcNow < deadline)
                {
                    using var socket = new TcpClient();
                    try
                    {
                        await socket.ConnectAsync("127.0.0.1", port);
                        return new LocalMqttBroker(name, port);
                    }
                    catch (SocketException)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(50));
                    }
                }
                throw new InvalidOperationException("The local MQTT test broker did not become ready.");
            }
            catch
            {
                await RunDockerAsync("stop", name);
                throw;
            }
        }

        public async ValueTask DisposeAsync()
        {
            await RunDockerAsync("stop", containerName);
        }

        private static async Task<(int ExitCode, string Output, string Error)> RunDockerAsync(params string[] arguments)
        {
            var startInfo = new ProcessStartInfo("docker")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var argument in arguments)
                startInfo.ArgumentList.Add(argument);

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Could not start Docker.");
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            return (process.ExitCode, await output, await error);
        }
    }

}

public sealed class LocalMosquittoFactAttribute : FactAttribute
{
    public LocalMosquittoFactAttribute()
    {
        const string skipReason = "MQTT end-to-end test requires Docker and the already-cached eclipse-mosquitto:2 image.";
        try
        {
            var startInfo = new ProcessStartInfo("docker")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            startInfo.ArgumentList.Add("image");
            startInfo.ArgumentList.Add("inspect");
            startInfo.ArgumentList.Add("--format={{.Id}}");
            startInfo.ArgumentList.Add("eclipse-mosquitto:2");
            using var process = Process.Start(startInfo);
            if (process is null || !process.WaitForExit(5000))
            {
                process?.Kill(true);
                process?.WaitForExit();
                Skip = skipReason;
            }
            else if (process.ExitCode != 0)
                Skip = skipReason;
        }
        catch (Win32Exception)
        {
            Skip = skipReason;
        }
    }
}

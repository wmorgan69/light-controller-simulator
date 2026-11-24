using Microsoft.Extensions.Logging.Abstractions;

public sealed class ControllerCleanupProcessorTests : IDisposable
{
    private readonly string path = Path.GetFullPath($"cleanup-{Guid.NewGuid():N}.db");

    [Fact]
    public async Task FailedCleanupRemainsDurableAndRetriesUntilConfirmed()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var removedId = initial.Active.Floors.Last().ControllerId;
        var saved = store.Save(initial.EditRevision,
            initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        var simulator = new BuildingSimulator();
        simulator.ActivateDesign(initial.Active);
        simulator.ActivateDesign(saved.Snapshot.Saved, () => store.ActivateSaved(saved.Snapshot.Saved.Revision));

        await ControllerCleanupProcessor.ProcessAsync(store, simulator,
            (_, _) => Task.FromException(new InvalidOperationException("Broker rejected publication")),
            NullLogger.Instance, CancellationToken.None);
        Assert.Equal(BuildingDesignCleanupStatus.Failed, Assert.Single(new BuildingDesignStore(path).ReadCleanup()).Status);

        var published = new List<string>();
        await ControllerCleanupProcessor.ProcessAsync(store, simulator,
            (id, _) => { published.Add(id); return Task.CompletedTask; },
            NullLogger.Instance, CancellationToken.None);
        Assert.Equal([removedId], published);
        Assert.Equal(BuildingDesignCleanupStatus.Completed, Assert.Single(store.ReadCleanup()).Status);
        await ControllerCleanupProcessor.ProcessAsync(store, simulator,
            (_, _) => throw new InvalidOperationException("Completed work must not be sent again"),
            NullLogger.Instance, CancellationToken.None);
    }

    [Fact]
    public async Task CancellationDoesNotMarkCleanupFailed()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision,
            initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        var simulator = new BuildingSimulator();
        simulator.ActivateDesign(initial.Active);
        simulator.ActivateDesign(saved.Snapshot.Saved, () => store.ActivateSaved(saved.Snapshot.Saved.Revision));
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            ControllerCleanupProcessor.ProcessAsync(store, simulator,
                (_, token) => Task.FromCanceled(token), NullLogger.Instance, cts.Token));
        Assert.Equal(BuildingDesignCleanupStatus.Pending, Assert.Single(store.ReadCleanup()).Status);
    }

    [Fact]
    public async Task SupersededInFlightCleanupIsReconfirmedAgainstNewRevision()
    {
        var store = new BuildingDesignStore(path);
        var initial = store.Read();
        var saved = store.Save(initial.EditRevision,
            initial.Saved with { Floors = initial.Saved.Floors.Take(3).ToArray() });
        var simulator = new BuildingSimulator();
        simulator.ActivateDesign(initial.Active);
        simulator.ActivateDesign(saved.Snapshot.Saved, () => store.ActivateSaved(saved.Snapshot.Saved.Revision));

        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var inFlight = ControllerCleanupProcessor.ProcessAsync(store, simulator, (_, _) =>
        {
            started.SetResult();
            return finish.Task;
        }, NullLogger.Instance, CancellationToken.None);
        await started.Task;
        var next = store.Save(saved.Snapshot.EditRevision, saved.Snapshot.Saved with { Width = 25 });
        simulator.ActivateDesign(next.Snapshot.Saved, () => store.ActivateSaved(next.Snapshot.Saved.Revision));
        finish.SetResult();
        await inFlight;
        var pending = Assert.Single(store.ReadCleanup());
        Assert.Equal(next.Snapshot.Saved.Revision, pending.ActiveRevision);
        Assert.Equal(BuildingDesignCleanupStatus.Pending, pending.Status);

        await ControllerCleanupProcessor.ProcessAsync(store, simulator, (_, _) => Task.CompletedTask,
            NullLogger.Instance, CancellationToken.None);
        Assert.Equal(BuildingDesignCleanupStatus.Completed, Assert.Single(store.ReadCleanup()).Status);
    }

    public void Dispose()
    {
        File.Delete(path);
        File.Delete(path + "-wal");
        File.Delete(path + "-shm");
    }
}

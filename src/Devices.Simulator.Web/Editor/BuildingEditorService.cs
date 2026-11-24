using Devices.Contracts;

public sealed record BuildingEditorState(
    BuildingDesign Design,
    BuildingDesign ActiveDesign,
    long EditRevision,
    string ActivationStatus,
    IReadOnlyList<BuildingDesignCleanup> Cleanup);

public sealed record BuildingEditorWriteRequest(long ExpectedRevision, BuildingDesign? Design);
public sealed record BuildingDesignStatus(long SavedRevision, long RunningRevision, string ActivationStatus,
    int PendingCleanup, int FailedCleanup, int CompletedCleanup);

public sealed class BuildingEditorService
{
    private readonly object gate = new();
    private readonly BuildingDesignStore store;
    private readonly BuildingSimulator simulator;
    private readonly MqttTelemetryPublisher mqtt;
    private readonly ILogger<BuildingEditorService> logger;
    private long? failedActivationRevision;

    public BuildingEditorService(BuildingDesignStore store, BuildingSimulator simulator,
        MqttTelemetryPublisher mqtt, ILogger<BuildingEditorService> logger)
    {
        this.store = store;
        this.simulator = simulator;
        this.mqtt = mqtt;
        this.logger = logger;
        var snapshot = store.Read();
        simulator.ActivateDesign(snapshot.Active);
        if (snapshot.Saved.Revision != snapshot.Active.Revision)
            TryActivate(snapshot.Saved);
    }

    public BuildingEditorState Read()
    {
        lock (gate) return State(store.Read());
    }

    public BuildingDesignStatus ReadStatus()
    {
        lock (gate)
        {
            var state = State(store.Read());
            return new BuildingDesignStatus(state.Design.Revision, state.ActiveDesign.Revision, state.ActivationStatus,
                state.Cleanup.Count(item => item.Status == BuildingDesignCleanupStatus.Pending),
                state.Cleanup.Count(item => item.Status == BuildingDesignCleanupStatus.Failed),
                state.Cleanup.Count(item => item.Status == BuildingDesignCleanupStatus.Completed));
        }
    }

    public IResult Save(BuildingEditorWriteRequest request)
    {
        lock (gate)
        {
            var result = store.Save(request.ExpectedRevision, request.Design);
            if (result.Status != BuildingDesignStoreStatus.Success) return WriteResult(result);
            TryActivate(result.Snapshot.Saved);
            return Results.Ok(State(store.Read()));
        }
    }

    public IResult Retry()
    {
        lock (gate)
        {
            TryActivate(store.Read().Saved);
            return Results.Ok(State(store.Read()));
        }
    }

    public IResult RetryCleanup()
    {
        lock (gate)
        {
            mqtt.RequestCleanup();
            return Results.Accepted(value: State(store.Read()));
        }
    }

    private bool TryActivate(BuildingDesign design)
    {
        try
        {
            var updated = simulator.ActivateDesign(design, () =>
            {
                var result = store.ActivateSaved(design.Revision);
                if (result.Status != BuildingDesignStoreStatus.Success)
                    throw new InvalidOperationException($"Activation was fenced: {result.Status}.");
            });
            foreach (var controller in updated)
                _ = mqtt.PublishAsync(controller);
            failedActivationRevision = null;
            return true;
        }
        catch (Exception exception)
        {
            failedActivationRevision = design.Revision;
            logger.LogError(exception, "Activation of building design revision {Revision} failed; the saved design remains pending", design.Revision);
            return false;
        }
    }

    private BuildingEditorState State(BuildingDesignSnapshot snapshot) =>
        new(snapshot.Saved, snapshot.Active, snapshot.EditRevision,
            snapshot.Saved.Revision == snapshot.Active.Revision ? "active" :
            snapshot.Saved.Revision == failedActivationRevision ? "failed" : "pending", store.ReadCleanup());

    private IResult WriteResult(BuildingDesignWriteResult result) => result.Status switch
    {
        BuildingDesignStoreStatus.Success => Results.Ok(State(result.Snapshot)),
        BuildingDesignStoreStatus.InvalidDesign => Results.BadRequest(new { detail = "The building design is invalid.", errors = result.Errors }),
        BuildingDesignStoreStatus.RevisionConflict => Results.Conflict(new { detail = "The design changed in another session." }),
        _ => Results.Conflict(new { detail = "The building design could not be updated." })
    };
}

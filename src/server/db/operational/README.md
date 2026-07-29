# Operational database boundary

The future operational plane owns mutable user work only. It must not copy or mutate scientific facts; references use `{snapshotId, entityType, sourceKey}`. No driver or connection is implemented here.

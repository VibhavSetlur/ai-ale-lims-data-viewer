"use client";
/* eslint-disable react-hooks/set-state-in-effect -- localStorage hydration initializes client-only editor state. */
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  adjacentWell,
  allWellIds,
  createCondition,
  createPlate,
} from "./document";
import {
  createPlateState,
  exportCsv,
  exportDocument,
  importDocument,
  plateReducer,
} from "./state";
import { reviewPlateDocument } from "./validation-review";
import type { WellId } from "./types";
import {
  loadStore,
  saveStore,
  updateWorkspace,
} from "../workspaces/local-repository";
import {
  Button,
  InlineNotice,
  Metric,
  PageHeader,
  Panel,
  SectionHeader,
  Toolbar,
} from "@/components/design-system/Primitives";
const download = (name: string, contents: string, type: string) => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};
export default function PlateWorkspace({
  designId,
}: Readonly<{ designId: string }>) {
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [state, dispatch] = useReducer(plateReducer, undefined, () =>
    createPlateState(),
  );
  const [selected, setSelected] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);
  const pending = useRef(false);
  const reload = () => {
    const loaded = loadStore(window.localStorage);
    if (!loaded.ok) {
      setStorageError(loaded.message);
      return;
    }
    const workspace = loaded.value.workspaces.find(
      (item) => item.id === designId,
    );
    if (!workspace) {
      setMissing(true);
      return;
    }
    hydrated.current = false;
    pending.current = false;
    dispatch({ type: "replace", document: workspace.document });
    setConflict(false);
    setReady(true);
  };
  useEffect(() => {
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "viewer2.workspaces.v1") return;
      if (pending.current) setConflict(true);
      else reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage); // reload is deliberately local to this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId]);
  useEffect(() => {
    if (!ready) return;
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    pending.current = true;
    const loaded = loadStore(window.localStorage);
    if (!loaded.ok) return setStorageError(loaded.message);
    const workspace = loaded.value.workspaces.find(
      (item) => item.id === designId,
    );
    if (!workspace) return setMissing(true);
    const saved = saveStore(
      window.localStorage,
      updateWorkspace(loaded.value, {
        ...workspace,
        document: state.document,
        snapshots: state.snapshots,
      }),
    );
    if (!saved.ok) return setStorageError(saved.message);
    pending.current = false;
  }, [designId, ready, state.document, state.snapshots]);
  const keepThisTab = () => {
    pending.current = true;
    setConflict(false);
    const loaded = loadStore(window.localStorage);
    if (!loaded.ok) return setStorageError(loaded.message);
    const workspace = loaded.value.workspaces.find(
      (item) => item.id === designId,
    );
    if (!workspace) return setMissing(true);
    const saved = saveStore(
      window.localStorage,
      updateWorkspace(loaded.value, {
        ...workspace,
        document: state.document,
        snapshots: state.snapshots,
      }),
    );
    if (!saved.ok) setStorageError(saved.message);
    else pending.current = false;
  };
  if (missing)
    return (
      <main>
        <p role="alert">This browser-local workspace was not found.</p>
        <Link href="/workspaces">View local workspaces</Link>
      </main>
    );
  const plate = state.document.plates[0];
  const assigned = plate
    ? Object.values(plate.wells).filter(Boolean).length
    : 0;
  const review = reviewPlateDocument(state.document);
  const move = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    well: WellId,
  ) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const target = adjacentWell(
      well,
      event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
    );
    if (target) document.getElementById(`well-${target}`)?.focus();
  };
  return (
    <main className="plate-workspace">
      <div className="plate-workspace-inner">
        <PageHeader eyebrow="BROWSER-LOCAL" title="96-well Plate Design">
          <p className="lede">
            Local only. This workspace never writes to LIMS. Use named
            conditions and exports to keep the design interpretable.
          </p>
        </PageHeader>
        <Toolbar className="plate-actions">
          <Button
            variant="secondary"
            onClick={() => dispatch({ type: "undo" })}
            disabled={!state.past.length}
          >
            Undo
          </Button>
          <Button
            variant="secondary"
            onClick={() => dispatch({ type: "redo" })}
            disabled={!state.future.length}
          >
            Redo
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const snapshot = {
                id: crypto.randomUUID(),
                name: state.document.name,
                savedAt: new Date().toISOString(),
                document: state.document,
              };
              dispatch({ type: "snapshot", snapshot });
            }}
          >
            Save snapshot
          </Button>
          <Metric
            label="Assigned wells"
            value={`${assigned} / 96`}
            detail="Autosaved locally"
          />
        </Toolbar>
        {storageError && (
          <InlineNotice tone="warning">{storageError}</InlineNotice>
        )}
        {conflict && (
          <InlineNotice tone="warning">
            Changed in another tab. <button onClick={reload}>Reload</button> or{" "}
            <button onClick={keepThisTab}>Keep this tab</button>.
          </InlineNotice>
        )}
        {(state.error || state.notice) && (
          <InlineNotice tone={state.error ? "warning" : "info"}>
            {state.error || state.notice}
          </InlineNotice>
        )}
        <Panel aria-labelledby="validation-review-title">
          <SectionHeader eyebrow="CHECK" title="Review and validation" />
          <p
            id="validation-review-title"
            role={review.errors.length ? "alert" : "status"}
            aria-live="polite"
            className="muted"
          >
            {review.summary}
          </p>
          {review.errors.length > 0 && (
            <ul>
              {review.errors.map((error) => (
                <li key={`${error.path}-${error.message}`}>
                  <strong>{error.path}:</strong> {error.message}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <div className="plate-document-fields">
            <label>
              Design name
              <input
                value={state.document.name}
                onChange={(event) =>
                  dispatch({
                    type: "replace",
                    document: { ...state.document, name: event.target.value },
                  })
                }
              />
            </label>
            <label>
              Run name
              <input
                value={state.document.run.name}
                onChange={(event) =>
                  dispatch({
                    type: "replace",
                    document: {
                      ...state.document,
                      run: { ...state.document.run, name: event.target.value },
                    },
                  })
                }
              />
            </label>
          </div>
        </Panel>
        <div className="plate-layout">
          <Panel className="condition-panel">
            <SectionHeader eyebrow="STEP 1" title="Conditions">
              <Button
                aria-label="Add condition"
                onClick={() =>
                  dispatch({
                    type: "add-condition",
                    condition: createCondition(
                      `Condition ${state.document.conditions.length + 1}`,
                    ),
                  })
                }
              >
                Add
              </Button>
            </SectionHeader>
            <div className="condition-list">
              {state.document.conditions.map((condition, index) => (
                <div key={condition.id}>
                  <button
                    className="condition-choice"
                    style={{ borderLeftColor: condition.color }}
                    aria-pressed={selected === condition.id}
                    onClick={() => setSelected(condition.id)}
                  >
                    <strong>{condition.name}</strong>
                    <span>
                      Condition {index + 1} · marker {condition.color}
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      dispatch({ type: "remove-condition", id: condition.id })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <p className="muted">
              Select a named condition, then select wells. Color supports the
              label but never replaces it.
            </p>
          </Panel>
          <Panel className="plate-grid-panel">
            <SectionHeader eyebrow="STEP 2" title={plate?.label ?? "No plate"}>
              <Metric
                label="Assigned wells"
                value={`${assigned} of 96`}
                detail="Arrow keys move between wells"
              />
            </SectionHeader>
            <Toolbar>
              <Button
                variant="secondary"
                onClick={() =>
                  plate && dispatch({ type: "clear-plate", plateId: plate.id })
                }
              >
                Clear plate
              </Button>
              <Button
                variant="secondary"
                disabled={!plate}
                onClick={() => {
                  if (!plate) return;
                  dispatch({
                    type: "duplicate-plate",
                    plateId: plate.id,
                    plate: {
                      ...createPlate(`${plate.label} copy`),
                      wells: structuredClone(plate.wells),
                    },
                  });
                }}
              >
                Duplicate plate
              </Button>
              <Button
                onClick={() =>
                  dispatch({
                    type: "add-plate",
                    plate: createPlate(
                      `Plate ${state.document.plates.length + 1}`,
                    ),
                  })
                }
              >
                Add plate
              </Button>
            </Toolbar>
            {plate ? (
              <div className="plate-grid-overflow">
                <div
                  role="grid"
                  aria-label="96-well plate"
                  className="plate-grid"
                >
                  {allWellIds().map((well) => {
                    const assignment = plate.wells[well];
                    const condition = state.document.conditions.find(
                      (item) => item.id === assignment?.conditionId,
                    );
                    return (
                      <button
                        id={`well-${well}`}
                        key={well}
                        role="gridcell"
                        aria-label={`${well}${condition ? `, ${condition.name}` : ", unassigned"}`}
                        className="plate-well"
                        data-assigned={Boolean(condition)}
                        style={{
                          background: condition?.color ?? "transparent",
                        }}
                        onKeyDown={(event) => move(event, well)}
                        onClick={() =>
                          selected
                            ? dispatch({
                                type: "assign",
                                plateId: plate.id,
                                wellId: well,
                                conditionId:
                                  assignment?.conditionId === selected
                                    ? undefined
                                    : selected,
                              })
                            : dispatch({
                                type: "error",
                                error:
                                  "Select a condition before assigning wells.",
                              })
                        }
                      >
                        <span>{well}</span>
                        <small>{condition?.name ?? "Unassigned"}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="empty-state">
                No plate is present. Add a plate to begin assigning named
                conditions.
              </p>
            )}
          </Panel>
        </div>
        <footer className="plate-export-actions">
          <Button
            variant="secondary"
            onClick={() =>
              download(
                "plate-design.json",
                exportDocument(state.document),
                "application/json",
              )
            }
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              download(
                "plate-assignments.csv",
                exportCsv(state.document),
                "text/csv",
              )
            }
          >
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => input.current?.click()}>
            Import JSON
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const result = importDocument(await file.text());
              if (result.document)
                dispatch({
                  type: "replace",
                  document: result.document,
                  notice: "Imported local document.",
                });
              else dispatch({ type: "error", error: result.error! });
              event.target.value = "";
            }}
          />
          <Button variant="quiet" onClick={() => dispatch({ type: "discard" })}>
            Discard draft
          </Button>
        </footer>
      </div>
    </main>
  );
}

import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);

export const filterSchema = z.object({
  column: identifier,
  operator: z.enum(["eq", "neq", "contains", "startsWith", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  value: scalar.optional(),
}).superRefine((filter, context) => {
  const requiresValue = filter.operator !== "isNull" && filter.operator !== "isNotNull";
  if (requiresValue && filter.value === undefined) context.addIssue({ code: "custom", message: "value is required for this operator.", path: ["value"] });
  if (!requiresValue && filter.value !== undefined) context.addIssue({ code: "custom", message: "value is not allowed for this operator.", path: ["value"] });
});

export const filterGroupSchema = z.object({
  combinator: z.enum(["and", "or"]),
  filters: z.array(filterSchema).min(1).max(50),
});

export const rowsQuerySchema = z.object({
  snapshotId: identifier,
  table: identifier,
  search: z.string().trim().min(1).max(500).optional(),
  where: filterGroupSchema.optional(),
  sort: z.array(z.object({ column: identifier, direction: z.enum(["asc", "desc"]) })).max(10).optional(),
  includeDeleted: z.boolean().optional(),
  cursor: z.string().min(1).max(2048).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000),
});

export const columnDescriptorSchema = z.object({
  key: identifier,
  label: z.string().trim().min(1).max(256),
  type: z.enum(["string", "number", "boolean", "date", "unknown"]),
  nullable: z.boolean(),
});

export const rowsResultSchema = z.object({
  columns: z.array(columnDescriptorSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().min(1).max(2048).nullable(),
  totalCount: z.number().int().nonnegative(),
});

export const facetsQuerySchema = z.object({
  snapshotId: identifier,
  table: identifier,
  columns: z.array(identifier).min(1).max(20),
  search: z.string().trim().min(1).max(500).optional(),
  where: filterGroupSchema.optional(),
  includeDeleted: z.boolean().optional(),
});

export const exportQuerySchema = rowsQuerySchema.extend({
  columns: z.array(identifier).min(1).max(100),
});

export type Filter = z.infer<typeof filterSchema>;
export type FilterGroup = z.infer<typeof filterGroupSchema>;
export type RowsQuery = z.infer<typeof rowsQuerySchema>;
export type ColumnDescriptor = z.infer<typeof columnDescriptorSchema>;
export type RowsResult = z.infer<typeof rowsResultSchema>;
export type FacetsQuery = z.infer<typeof facetsQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;

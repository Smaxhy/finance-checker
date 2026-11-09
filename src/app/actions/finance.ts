"use server";
// Server wrappers - the logic lives in src/lib/actions/finance.ts.
import * as impl from "@/lib/actions/finance";

export type { CsvPreview } from "@/lib/actions/finance";

export async function updateTransactionCategory(...args: Parameters<typeof impl.updateTransactionCategory>): ReturnType<typeof impl.updateTransactionCategory> {
  return impl.updateTransactionCategory(...args);
}

export async function updateTransactionDetails(...args: Parameters<typeof impl.updateTransactionDetails>): ReturnType<typeof impl.updateTransactionDetails> {
  return impl.updateTransactionDetails(...args);
}

export async function addManualTransaction(...args: Parameters<typeof impl.addManualTransaction>): ReturnType<typeof impl.addManualTransaction> {
  return impl.addManualTransaction(...args);
}

export async function deleteTransaction(...args: Parameters<typeof impl.deleteTransaction>): ReturnType<typeof impl.deleteTransaction> {
  return impl.deleteTransaction(...args);
}

export async function previewCsvImport(...args: Parameters<typeof impl.previewCsvImport>): ReturnType<typeof impl.previewCsvImport> {
  return impl.previewCsvImport(...args);
}

export async function importCsv(...args: Parameters<typeof impl.importCsv>): ReturnType<typeof impl.importCsv> {
  return impl.importCsv(...args);
}

export async function createCategory(...args: Parameters<typeof impl.createCategory>): ReturnType<typeof impl.createCategory> {
  return impl.createCategory(...args);
}

export async function deleteCategory(...args: Parameters<typeof impl.deleteCategory>): ReturnType<typeof impl.deleteCategory> {
  return impl.deleteCategory(...args);
}

export async function deleteCategoryRule(...args: Parameters<typeof impl.deleteCategoryRule>): ReturnType<typeof impl.deleteCategoryRule> {
  return impl.deleteCategoryRule(...args);
}

export async function createCategoryRule(...args: Parameters<typeof impl.createCategoryRule>): ReturnType<typeof impl.createCategoryRule> {
  return impl.createCategoryRule(...args);
}

export async function saveBudget(...args: Parameters<typeof impl.saveBudget>): ReturnType<typeof impl.saveBudget> {
  return impl.saveBudget(...args);
}

export async function deleteBudget(...args: Parameters<typeof impl.deleteBudget>): ReturnType<typeof impl.deleteBudget> {
  return impl.deleteBudget(...args);
}

export async function deleteAccount(...args: Parameters<typeof impl.deleteAccount>): ReturnType<typeof impl.deleteAccount> {
  return impl.deleteAccount(...args);
}

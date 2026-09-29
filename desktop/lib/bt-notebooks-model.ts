export interface Notebook { id: string; name: string }
export interface QuickNote { id: string; notebookId: string; text: string; createdAt: string; updatedAt: string }
export interface Notebooks { revision: number; books: Notebook[]; notes: QuickNote[] }

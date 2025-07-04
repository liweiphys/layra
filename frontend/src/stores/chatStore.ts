// store/conversationStore.ts
import { create } from "zustand";

interface ChatState {
  chatId: string;
  setChatId: (id: string) => void;
  chatName: string;
  setChatName: (name: string) => void;
  chatflowId: string;
  setChatflowId: (id: string) => void;
  chatflowName: string;
  setChatflowName: (name: string) => void;
}

const useChatStore = create<ChatState>()(
    (set) => ({
      chatId: "",
      setChatId: (id) => set({ chatId: id }),
      chatName: "",
      setChatName: (name) => set({ chatName: name }),
      chatflowId: "",
      setChatflowId: (id) => set({ chatflowId: id }),
      chatflowName: "",
      setChatflowName: (name) => set({ chatflowName: name }),
    }),
);

export default useChatStore;

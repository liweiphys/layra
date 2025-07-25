// components/ChatBox.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ConversationBlock,
  FileRespose,
  Message,
  ModelConfig,
} from "@/types/types";
import ChatMessage from "./ChatMessage";
import {
  getFileExtension,
  getFileIcon,
  SupportFileFormat,
  SupportUploadFormat,
} from "@/utils/file";
import { uploadFiles } from "@/lib/api/chatApi";
import { useAuthStore } from "@/stores/authStore";
import KnowledgeConfigModal from "./KnowledgeConfigModal";
import useModelConfigStore from "@/stores/configStore";
import useChatStore from "@/stores/chatStore";
import Cookies from "js-cookie";
import { EventSourceParserStream } from "eventsource-parser/stream";
import {
  deleteFile,
  deleteTempKnowledgeBase,
} from "@/lib/api/knowledgeBaseApi";
import { updateModelConfig } from "@/lib/api/configApi";
import {
  buildConversationBlocks,
  calculateCurrentPath,
  calculateDefaultBranches,
} from "@/utils/message";

interface ChatBoxProps {
  messages: Message[]; //常规历史消息，后台数据库读取
  sendDisabled: boolean;
  receivingMessageId: string | null; // sse实时传输消息会话ID
  receivingMessages: Message[]; // sse实时传输消息
  onSendMessage: (
    message: string,
    files: FileRespose[],
    tempBaseId: string,
    parentMessageId: string
  ) => void;
  onAbort: () => void; // 新增的中断回调
}

const ChatBox: React.FC<ChatBoxProps> = ({
  messages,
  receivingMessageId,
  receivingMessages,
  onSendMessage,
  sendDisabled,
  onAbort,
}) => {
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null); // 创建引用
  const fileInputRef = useRef<HTMLInputElement>(null); // 新增文件输入引用
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sendingFiles, setSendingFiles] = useState<FileRespose[]>([]);
  const [tempBaseId, setTempBaseId] = useState<string>(""); //后台用来存放上传文件的临时知识库
  const [fileDivStyle, setFileDivStyle] = useState({});
  const { user } = useAuthStore();
  const { modelConfig, setModelConfig } = useModelConfigStore();
  const [uploadProgress, setUploadProgress] = useState<number | null>(0);
  const [taskStatus, setTaskStatus] = useState<
    "processing" | "completed" | "failed" | null
  >(null);
  const [taskProgress, setTaskProgress] = useState<number>(0);
  const [uploadFile, setUploadFile] = useState<boolean>(false);
  const [showRefFile, setShowRefFile] = useState<string[]>([]);
  const [cleanTempBase, setCleanTempBase] = useState<boolean>(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null); // 消息容器的ref

  // 修改发送按钮逻辑
  const isUploadComplete = uploadProgress === 100;
  const isTaskComplete = taskStatus === "completed";
  const isSendDisabled = (!isUploadComplete || !isTaskComplete) && uploadFile;

  let buttonText;
  if (!uploadFile) {
    buttonText = "Send";
  } else if (!isUploadComplete) {
    buttonText = `Upload:${uploadProgress}%`;
  } else if (!isTaskComplete) {
    buttonText =
      taskStatus === "failed" ? "Upload Failed" : `Processing:${taskProgress}%`;
  } else {
    buttonText = "Send";
  }

  // 在ChatBox组件内新增状态
  const [showConfigModal, setShowConfigModal] = useState(false);
  const { chatId } = useChatStore();

  /////////////////////////////////////////////////
  // 树结构转换代码，转换前端对话数据格式为树结构以支持切换不同分支的历史消息，实现消息回溯功能
  // sse新AI消息更新时，只更新树结构对应该消息的最后的节点，以减少计算量
  // 树结构转换代码start
  const [selectedBranches, setSelectedBranches] = useState<
    Record<string, number>
  >({});
  const [currentPath, setCurrentPath] = useState<ConversationBlock[]>([]);
  // 缓存上一次的 blocks
  const prevBlocksRef = useRef<ConversationBlock[]>([]);
  const prevPathRef = useRef<ConversationBlock[]>([]);
  const prevReceivingLengthRef = useRef(receivingMessages.length);
  const prevDefaultSelectIdRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (receivingMessages.length === 0) {
      prevReceivingLengthRef.current = 0;
    }
  }, [receivingMessages.length]);

  // 构建对话块Tree结构
  const conversationBlocks = useMemo(() => {
    // 初始化rawMessages
    let rawMessages: Message[] = [];
    const isReceiving = chatId === receivingMessageId;
    if (!isReceiving) {
      rawMessages = messages;
      //重置prevReceivingLengthRef长度，使得prevBlocksRef.current从历史消息切回sse消息，正确更新
      prevReceivingLengthRef.current = 0;
    } else {
      rawMessages = receivingMessages;
    }

    // 使用工具函数构建 blocks
    const newBlocks = buildConversationBlocks(
      rawMessages,
      prevBlocksRef.current,
      prevReceivingLengthRef.current,
      isReceiving
    );

    prevBlocksRef.current = newBlocks;
    return newBlocks;
  }, [chatId, receivingMessageId, messages, receivingMessages]);

  const [refreshPath, setRefreshPath] = useState(false);
  // 计算并设置默认分支 1
  // recMsg.len从0变为有限，开始接收消息，需重新计算默认分支index，并更新path
  // recMsg.len变回0为接收完毕清空recMsg，此时无需计算默认分支index,但path需更新
  useEffect(() => {
    if (receivingMessages.length === 0) {
      setRefreshPath(true);
      return;
    }

    const defaultBranches = calculateDefaultBranches(prevBlocksRef.current);
    prevDefaultSelectIdRef.current = defaultBranches;
    setSelectedBranches(defaultBranches);
  }, [receivingMessages.length]);

  // 计算并设置默认分支 2
  // 切换对话需重新计算
  useEffect(() => {
    const defaultBranches = calculateDefaultBranches(prevBlocksRef.current);
    prevDefaultSelectIdRef.current = defaultBranches;
    setSelectedBranches(defaultBranches);
  }, [chatId]);

  // 响应分支变化重新计算路径 1
  // 特殊处理：接收消息时保持路径稳定性,以节省计算量
  useEffect(() => {
    const hasChanged =
      Object.keys(prevDefaultSelectIdRef.current).some(
        (key) => selectedBranches[key] !== prevDefaultSelectIdRef.current[key]
      ) ||
      Object.keys(selectedBranches).length !==
        Object.keys(prevDefaultSelectIdRef.current).length;

    if (hasChanged) {
      return;
    }

    if (
      chatId === receivingMessageId &&
      prevReceivingLengthRef.current === receivingMessages.length &&
      prevPathRef.current.length > 0 &&
      prevBlocksRef.current.length > 0
    ) {
      const newPath = [...prevPathRef.current];
      const lastBlockIndex = newPath.length - 1;
      newPath[lastBlockIndex] = {
        ...prevBlocksRef.current[prevBlocksRef.current.length - 1],
      };
      setCurrentPath(newPath);
      // 更新 refs 以便下一次计算使用
      prevPathRef.current = newPath;
    }
  }, [chatId, receivingMessageId, receivingMessages, selectedBranches]);

  // 响应分支变化重新计算路径 2
  // 正常路径需重新计算
  const [updatePrevLen, setUpdatePrevLen] = useState(false);
  useEffect(() => {
    const newPath = calculateCurrentPath(
      prevBlocksRef.current,
      selectedBranches
    );
    setCurrentPath(newPath);

    // 更新 refs 以便下一次计算使用
    prevPathRef.current = newPath;
    setUpdatePrevLen(true);
  }, [selectedBranches]);

  useEffect(() => {
    if (updatePrevLen && receivingMessages.length !== 0) {
      prevReceivingLengthRef.current = receivingMessages.length;
      setUpdatePrevLen(false);
    }
  }, [updatePrevLen, receivingMessages.length]);

  // 响应分支变化重新计算路径 3
  // sse接收完毕,path需更新为messages
  useEffect(() => {
    if (refreshPath) {
      setRefreshPath(false);
      const newPath = calculateCurrentPath(
        prevBlocksRef.current,
        selectedBranches
      );
      setCurrentPath(newPath);
      // 更新 refs 以便下一次计算使用
      prevPathRef.current = newPath;
    }
  }, [refreshPath, setRefreshPath, selectedBranches]);

  // 处理分支切换
  const handleBranchChange = useCallback(
    (parentId: string, newIndex: number) => {
      setSelectedBranches((prev) => ({
        ...prev,
        [parentId]: newIndex,
      }));
    },
    []
  );

  // 树结构转换end
  /////////////////////////////////////////////////

  // 支持的文件类型
  const supportedExtensions = SupportFileFormat;

  const handleSend = (lastAIMessageId: string) => {
    if (inputMessage.trim()) {
      // 发送用户消息
      onSendMessage(inputMessage, sendingFiles, tempBaseId, lastAIMessageId);
      setInputMessage("");
      setSendingFiles([]);
      setTempBaseId("");
      setUploadFile(false);
      // 重置高度
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleSendEditingMessage = (
    inputMessage: string,
    sendingFiles: FileRespose[],
    tempBaseId: string,
    parentMessageId: string
  ) => {
    if (inputMessage.trim()) {
      // 发送用户消息
      onSendMessage(inputMessage, sendingFiles, tempBaseId, parentMessageId);
    }
  };

  // 清理悬空临时知识库
  useEffect(() => {
    const cleanTempKnowledgeBase = async () => {
      if (user?.name) {
        try {
          setCleanTempBase(true);
          const response = await deleteTempKnowledgeBase(user.name);
        } catch (error) {
          console.error("Error clean temp knowledge base:", error);
        } finally {
          setCleanTempBase(false);
        }
      }
    };
    cleanTempKnowledgeBase();
  }, [user?.name]); // 添加 user?.name 作为依赖

  // 监听滚动事件
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const threshold = 100; // 距离底部的阈值
      const isBottom =
        container.scrollHeight - container.scrollTop <=
        container.clientHeight + threshold;
      setIsAtBottom(isBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [receivingMessages]);

  // 消息更新时的滚动逻辑
  useEffect(() => {
    const hasChanged =
      Object.keys(prevDefaultSelectIdRef.current).some(
        (key) => selectedBranches[key] !== prevDefaultSelectIdRef.current[key]
      ) ||
      Object.keys(selectedBranches).length !==
        Object.keys(prevDefaultSelectIdRef.current).length;

    if (
      !hasChanged &&
      messagesEndRef.current &&
      isAtBottom &&
      chatId === receivingMessageId
    ) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [isAtBottom, chatId, receivingMessageId, currentPath, selectedBranches]);

  // 在组件内部定义
  const shouldScrollOnPathReady = useRef(false); // 标记是否为新对话

  // 切换对话时重置标记
  useEffect(() => {
    shouldScrollOnPathReady.current = true;
  }, [chatId]);

  // 切换对话时滚动
  useEffect(() => {
    if (shouldScrollOnPathReady.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
      shouldScrollOnPathReady.current = false;
    }
  }, [currentPath]);

  useEffect(() => {
    setSendingFiles([]);
    setTempBaseId("");
    setUploadFile(false);
  }, [chatId]);

  const configureKnowledgeDB = () => {
    setShowConfigModal(true);
  };

  // 新增保存配置方法
  const handleSaveConfig = async (config: ModelConfig) => {
    if (user?.name) {
      try {
        //更新数据库使用
        setModelConfig(config);
        await updateModelConfig(user.name, config);
      } catch (error) {
        console.error("保存配置失败:", error);
      }
    }
  };

  // 触发文件选择对话框
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleDeleteFile = async (id: string) => {
    try {
      setSendingFiles((prevFiles) =>
        prevFiles.filter((file) => file.id !== id)
      );
      await deleteFile(tempBaseId, id);
    } catch (error) {
      console.error("Error delete file:", error);
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) => {
      const ext = getFileExtension(file.name);
      return supportedExtensions.includes(ext);
    });

    const invalidFiles = files.filter((file) => {
      const ext = getFileExtension(file.name);
      return !supportedExtensions.includes(ext);
    });

    if (invalidFiles.length > 0) {
      alert(
        `Unsupport file type: \n${invalidFiles.map((f) => f.name).join("\n")}`
      );
    }

    if (validFiles.length > 0 && user?.name) {
      setUploadProgress(0); // 重置上传进度
      setTaskStatus(null); // 重置任务状态
      setUploadFile(true);

      uploadFiles(validFiles, user.name, chatId, (percent) => {
        setUploadProgress(percent); // 更新上传进度
      })
        .then(async (response) => {
          setSendingFiles((prev) => [...prev, ...response?.data.files]);
          setTempBaseId(response?.data.knowledge_db_id);

          // 使用fetch代替EventSource
          const token = Cookies.get("token"); // 确保已引入cookie库
          const taskId = response?.data.task_id;

          try {
            const response = await fetch(
              `${process.env.NEXT_PUBLIC_API_BASE_URL}/sse/task/${user.name}/${taskId}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (!response.ok) throw new Error("Request failed");
            if (!response.body) return;

            // 使用EventSourceParserStream处理流
            const eventStream = response.body
              ?.pipeThrough(new TextDecoderStream())
              .pipeThrough(new EventSourceParserStream());

            const eventReader = eventStream.getReader();
            while (true) {
              const { done, value } = (await eventReader?.read()) || {};
              if (done) break;

              const payload = JSON.parse(value.data);
              // 处理事件数据
              if (payload.event === "progress") {
                const progress = payload.total > 0 ? payload.progress : 0;

                setTaskProgress(progress);
                setTaskStatus(payload.status);

                if (["completed", "failed"].includes(payload.status)) {
                  if (payload.status === "failed") {
                    alert("Embedding error!");
                  }
                  eventReader.cancel();
                  break;
                }
              }
            }
          } catch (error) {
            console.error("SSE错误:", error);
            setTaskStatus("failed");
          }
        })
        .catch((error) => {
          alert("Upload error");
        });
    }

    e.target.value = "";
  };

  const handleDownload = async (url: string) => {
    try {
      window.open(url, "_blank");
    } catch (error) {
      console.error("Download failed:", error);
      alert("Download failed!");
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      const height = textareaRef.current.getBoundingClientRect().height;
      setFileDivStyle({ bottom: `calc(55% + ${height}px/2` });
      // 如果需要，还可以设置 left 或其他样式属性
    }
  }, [inputMessage]); // 这个 effect 只在组件挂载时运行一次

  return (
    <div className="w-[80%] flex-none h-full rounded-3xl p-4 flex flex-col">
      <div className="flex-1 min-h-0 overflow-hidden">
        {currentPath.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center gap-4 bg-white/30 rounded-xl">
            <div className="h-[30vh]"></div>
            <p className="text-lg">
              Please remember to choose which knowledge database you will use
              for this chat.
            </p>
            <button
              className="bg-indigo-500 hover:bg-indigo-600 rounded-full text-base px-4 py-2 text-white flex gap-1 cursor-pointer"
              onClick={configureKnowledgeDB}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="size-5 my-auto"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v2.5h-2.5a.75.75 0 0 0 0 1.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-2.5Z"
                  clipRule="evenodd"
                />
              </svg>
              <div>Configure Now</div>
            </button>
            <div className="flex items-center justify-center gap-2 text-indigo-500 font-semibold">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-5"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm0 8.625a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM15.375 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0ZM7.5 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z"
                  clipRule="evenodd"
                />
              </svg>
              {modelConfig.modelName ? (
                <div className="text-indigo-500">{modelConfig.modelName}</div>
              ) : (
                <div className="text-indigo-500">No LLM engine was choosed</div>
              )}
            </div>
            {modelConfig.baseUsed.length > 0 ? (
              <div className="flex items-center justify-center w-full text-sm text-indigo-500 font-semibold gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="size-5"
                >
                  <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
                </svg>
                <div className="whitespace-nowrap">
                  {" "}
                  Knowledge-Base accessed:
                </div>
                <div className="whitespace-nowrap overflow-x-scroll scrollbar-hide flex gap-2">
                  {modelConfig.baseUsed.map((base, index) => (
                    <div
                      className="flex gap-1 items-center justify-center"
                      key={index}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="size-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 1c3.866 0 7 1.79 7 4s-3.134 4-7 4-7-1.79-7-4 3.134-4 7-4Zm5.694 8.13c.464-.264.91-.583 1.306-.952V10c0 2.21-3.134 4-7 4s-7-1.79-7-4V8.178c.396.37.842.688 1.306.953C5.838 10.006 7.854 10.5 10 10.5s4.162-.494 5.694-1.37ZM3 13.179V15c0 2.21 3.134 4 7 4s7-1.79 7-4v-1.822c-.396.37-.842.688-1.306.953-1.532.875-3.548 1.369-5.694 1.369s-4.162-.494-5.694-1.37A7.009 7.009 0 0 1 3 13.179Z"
                          clipRule="evenodd"
                          transform="translate(0, -0.5)"
                        />
                      </svg>
                      <span>{base.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center w-full text-sm text-indigo-500 font-semibold gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="size-5"
                >
                  <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
                </svg>
                <div className="whitespace-nowrap">
                  No Knowledge-Base was accessed‌
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="h-[100%] w-full flex flex-col mx-auto">
            <div className="shadow-xs rounded-xl pb-2 mx-[12%] mb-2 flex flex-col item-center justify-center gap-1">
              <div className="w-full px-10 text-sm flex items-center justify-center gap-2 text-indigo-500 font-semibold">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm0 8.625a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM15.375 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0ZM7.5 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z"
                    clipRule="evenodd"
                  />
                </svg>
                {modelConfig.modelName ? (
                  <div className="text-indigo-500 whitespace-nowrap overflow-x-scroll scrollbar-hide ">
                    {modelConfig.modelName}
                  </div>
                ) : (
                  <div className="text-indigo-500">
                    No LLM engine was choosed
                  </div>
                )}
              </div>
              {modelConfig.baseUsed.length > 0 ? (
                <div className="px-10 flex items-center justify-center w-full text-sm text-indigo-500 font-semibold gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="size-5"
                  >
                    <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
                  </svg>
                  <div className="whitespace-nowrap">
                    {" "}
                    Knowledge-Base accessed:
                  </div>
                  <div className="whitespace-nowrap overflow-x-scroll scrollbar-hide flex gap-2">
                    {modelConfig.baseUsed.map((base, index) => (
                      <div
                        className="flex gap-1 items-center justify-center"
                        key={index}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="size-4"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 1c3.866 0 7 1.79 7 4s-3.134 4-7 4-7-1.79-7-4 3.134-4 7-4Zm5.694 8.13c.464-.264.91-.583 1.306-.952V10c0 2.21-3.134 4-7 4s-7-1.79-7-4V8.178c.396.37.842.688 1.306.953C5.838 10.006 7.854 10.5 10 10.5s4.162-.494 5.694-1.37ZM3 13.179V15c0 2.21 3.134 4 7 4s7-1.79 7-4v-1.822c-.396.37-.842.688-1.306.953-1.532.875-3.548 1.369-5.694 1.369s-4.162-.494-5.694-1.37A7.009 7.009 0 0 1 3 13.179Z"
                            clipRule="evenodd"
                            transform="translate(0, -0.5)"
                          />
                        </svg>
                        <span>{base.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-10 flex items-center justify-center w-full text-sm text-indigo-500 font-semibold gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="size-5"
                  >
                    <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
                  </svg>
                  <div className="whitespace-nowrap">
                    No Knowledge-Base was accessed‌
                  </div>
                </div>
              )}
            </div>
            <div
              className="flex-1 overflow-y-auto scrollbar-auto px-[12%]"
              style={{ overscrollBehavior: "contain" }}
              ref={scrollContainerRef} // 添加滚动容器的引用
            >
              {
                // 渲染对话块
                currentPath.map((block, blockIndex) => (
                  <div key={blockIndex}>
                    {block.otherUserMessage.map((msg, index) => (
                      <ChatMessage
                        modelConfig={modelConfig}
                        key={index}
                        message={msg}
                        showRefFile={showRefFile}
                        setShowRefFile={setShowRefFile}
                        onSendEditingMessage={handleSendEditingMessage}
                        sendDisabled={sendDisabled}
                        enableOperation={true}
                        lastUserMessage={() => ""}
                        isLastMessage={blockIndex === currentPath.length - 1}
                      />
                    ))}
                    <ChatMessage
                      modelConfig={modelConfig}
                      message={block.userMessage}
                      showRefFile={showRefFile}
                      setShowRefFile={setShowRefFile}
                      onSendEditingMessage={handleSendEditingMessage}
                      sendDisabled={sendDisabled}
                      enableOperation={true}
                      lastUserMessage={() => ""}
                      handleBranchChange={handleBranchChange} // 处理分支切换
                      branchIndex={block.branchIndex} // 当前分支索引
                      branchCount={block.branchCount} // 分支总数
                      parentId={block.parentId} // 父节点 ID
                      isLastMessage={blockIndex === currentPath.length - 1}
                    />
                    {block.aiMessages.map((aiMsg, aiIndex) => (
                      <ChatMessage
                        modelConfig={modelConfig}
                        key={aiIndex}
                        message={aiMsg}
                        showRefFile={showRefFile}
                        setShowRefFile={setShowRefFile}
                        onSendEditingMessage={handleSendEditingMessage}
                        sendDisabled={sendDisabled}
                        enableOperation={true}
                        lastUserMessage={() => block.userMessage.content || ""}
                        handleBranchChange={handleBranchChange} // 处理分支切换
                        branchIndex={block.branchIndex} // 当前分支索引
                        branchCount={block.branchCount} // 分支总数
                        parentId={block.parentId} // 父节点 ID
                        isLastMessage={blockIndex === currentPath.length - 1}
                      />
                    ))}
                  </div>
                ))
              }
              {/* 这个 div 用于滚动到底部 */}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>
      {/* 新增定位容器 */}
      <div className="relative w-[75%] mt-4 mb-4 max-h-[40%] flex items-center justify-center gap-4 mx-auto">
        <div className="relative min-w-[75%] h-[100%]">
          <div className="flex justify-center items-center h-full">
            <textarea
              ref={textareaRef}
              className="pl-11 pr-8 w-full py-3 min-h-[40%] max-h-[100%] border-indigo-500 border-2 rounded-3xl text-base focus:outline-hidden focus:border-indigo-600 focus:border-[2.5px] resize-none overflow-y-auto"
              placeholder="Press Shift+Enter to send..."
              value={inputMessage}
              rows={1}
              onChange={(e) => {
                setInputMessage(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  if (!isSendDisabled && !sendDisabled) {
                    let lastAIMessageId: string = "";
                    // 如果没有提供 parentMessageId，则查找最后一条 AI 消息的 ID
                    if (currentPath.length > 0) {
                      lastAIMessageId =
                        currentPath[currentPath.length - 1].aiMessages[0]
                          .messageId || "";
                    }
                    handleSend(lastAIMessageId);
                  }
                }
              }}
            />
          </div>

          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-5 absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer text-gray-400"
            onClick={() => {
              setInputMessage("");
              // 重置高度
              if (textareaRef.current) {
                textareaRef.current.style.height = "auto";
              }
            }} // 点击时清空输入框内容
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
              clipRule="evenodd"
            />
          </svg>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={`size-6 absolute left-3 top-1/2 transform -translate-y-1/2 ${
              isSendDisabled || cleanTempBase
                ? "cursor-not-allowed"
                : "cursor-pointer"
            }`}
            onClick={() => {
              if (!isSendDisabled && !cleanTempBase) {
                return triggerFileInput();
              }
            }} // 点击时清空输入框内容
          >
            <path
              fillRule="evenodd"
              d="M18.97 3.659a2.25 2.25 0 0 0-3.182 0l-10.94 10.94a3.75 3.75 0 1 0 5.304 5.303l7.693-7.693a.75.75 0 0 1 1.06 1.06l-7.693 7.693a5.25 5.25 0 1 1-7.424-7.424l10.939-10.94a3.75 3.75 0 1 1 5.303 5.304L9.097 18.835l-.008.008-.007.007-.002.002-.003.002A2.25 2.25 0 0 1 5.91 15.66l7.81-7.81a.75.75 0 0 1 1.061 1.06l-7.81 7.81a.75.75 0 0 0 1.054 1.068L18.97 6.84a2.25 2.25 0 0 0 0-3.182Z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-xs absolute left-[calc(12px+18px)] top-[calc(50%+10px)] transform -translate-y-1/2">
            {sendingFiles.length}
          </div>
          {/* 隐藏的文件输入 */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept={SupportUploadFormat}
            onChange={handleFileSelected}
          />
          <div
            className="flex-col gap-1 absolute left-[1%]"
            style={fileDivStyle}
          >
            {sendingFiles &&
              sendingFiles.map((file, index) => (
                <div
                  className="w-full overflow-hidden flex gap-1 mt-1 text-xs bg-white"
                  key={index}
                >
                  <span>{getFileIcon(getFileExtension(file.filename))}</span>
                  <span
                    onClick={() => handleDownload(file.url ? file.url : "")}
                    className="hover:text-indigo-500 hover:cursor-pointer"
                  >
                    {file.filename}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                    className={`size-4 text-indigo-500 hover:text-indigo-700 ${
                      isSendDisabled || cleanTempBase
                        ? "cursor-not-allowed"
                        : "cursor-pointer"
                    }`}
                    onClick={() => {
                      if (!isSendDisabled && !cleanTempBase) {
                        return handleDeleteFile(file.id);
                      }
                    }}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              ))}
          </div>
        </div>
        {(!sendDisabled || !receivingMessageId) && (
          <button
            className={`min-w-[13%] flex gap-1 ${
              isSendDisabled || sendDisabled
                ? "bg-indigo-300 cursor-not-allowed"
                : "bg-indigo-500 hover:bg-indigo-600 cursor-pointer"
            } rounded-full text-base item-center justify-center px-5 py-2 text-white`}
            onClick={() => {
              let lastAIMessageId: string = "";
              // 如果没有提供 parentMessageId，则查找最后一条 AI 消息的 ID
              if (currentPath.length > 0) {
                lastAIMessageId =
                  currentPath[currentPath.length - 1].aiMessages[0].messageId ||
                  "";
              }
              handleSend(lastAIMessageId);
            }}
            disabled={isSendDisabled || sendDisabled}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-6 shrink-0"
            >
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
            {buttonText}
          </button>
        )}
        {/* 添加中断按钮 */}
        {sendDisabled && receivingMessageId && (
          <button
            className={`min-w-[13%] flex gap-1 ${
              sendDisabled
                ? "bg-indigo-500 hover:bg-indigo-600 cursor-pointer"
                : "bg-indigo-300 cursor-not-allowed"
            } rounded-full text-base item-center justify-center px-5 py-2 text-white`}
            onClick={onAbort}
            disabled={!sendDisabled}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-6 shrink-0"
            >
              <path
                fillRule="evenodd"
                d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm6-2.438c0-.724.588-1.312 1.313-1.312h4.874c.725 0 1.313.588 1.313 1.313v4.874c0 .725-.588 1.313-1.313 1.313H9.564a1.312 1.312 0 0 1-1.313-1.313V9.564Z"
                clipRule="evenodd"
              />
            </svg>
            Stop
          </button>
        )}
      </div>
      <KnowledgeConfigModal
        visible={showConfigModal}
        setVisible={setShowConfigModal}
        onSave={handleSaveConfig}
      />
    </div>
  );
};

export default ChatBox;

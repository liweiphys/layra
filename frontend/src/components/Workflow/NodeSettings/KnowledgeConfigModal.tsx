import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuthStore } from "@/stores/authStore";
import { CustomNode, KnowledgeBase, ModelConfig } from "@/types/types";
import { getAllKnowledgeBase } from "@/lib/api/knowledgeBaseApi";
import {
  addModelConfig,
  deleteModelConfig,
  getAllModelConfig,
} from "@/lib/api/configApi";
import { useClickAway } from "react-use";
import AddLLMEngine from "@/components/AiChat/AddLLMEngine";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useFlowStore } from "@/stores/flowStore";

interface ConfigModalProps {
  node: CustomNode;
  visible: boolean;
  setVisible: Dispatch<SetStateAction<boolean>>;
  onSave: (newModelConfig: ModelConfig) => void;
}

const KnowledgeConfigModal: React.FC<ConfigModalProps> = ({
  node,
  visible,
  setVisible,
  onSave,
}) => {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [showAddLLM, setShowAddLLM] = useState<boolean>(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showConfirmDeleteConfig, setShowConfirmDeleteConfig] = useState<{
    config: ModelConfig;
  } | null>(null);
  const { updateVlmModelConfig } = useFlowStore();
  const { user } = useAuthStore();
  // 在组件内
  const ref = useRef(null);
  useClickAway(ref, () => {
    setShowDropdown(false);
  });

  const fetchKnowledgeBasesAndAllModelConfig = useCallback(async () => {
    // API调用
    if (user?.name) {
      try {
        const responseBase = await getAllKnowledgeBase(user.name);
        const bases: KnowledgeBase[] = responseBase.data.map((item: any) => ({
          name: item.knowledge_base_name,
          id: item.knowledge_base_id,
          selected: false,
        }));

        const response = await getAllModelConfig(user.name);
        const modelConfigsResponse: ModelConfig[] = response.data.models.map(
          (item: any) => ({
            modelId: item.model_id,
            modelName: item.model_name,
            modelURL: item.model_url,
            apiKey: item.api_key,
            baseUsed: item.base_used,
            systemPrompt: item.system_prompt,
            temperature: item.temperature === -1 ? 0.1 : item.temperature,
            maxLength: item.max_length === -1 ? 8192 : item.max_length,
            topP: item.top_P === -1 ? 0.01 : item.top_P,
            topK: item.top_K === -1 ? 3 : item.top_K,
            scoreThreshold:
              item.score_threshold === -1 ? 10 : item.score_threshold,
            useTemperatureDefault: item.temperature === -1 ? true : false,
            useMaxLengthDefault: item.max_length === -1 ? true : false,
            useTopPDefault: item.top_P === -1 ? true : false,
            useTopKDefault: item.top_K === -1 ? true : false,
            useScoreThresholdDefault:
              item.score_threshold === -1 ? true : false,
          })
        );

        const selected = modelConfigsResponse.find(
          (m) => m.modelId === node.data.modelConfig?.modelId
        );
        // 更新knowledgeBases的selected状态
        if (selected) {
          const updatedKnowledgeBases = bases.map((kb) => ({
            ...kb,
            selected: selected.baseUsed.some((bu) => bu.baseId === kb.id),
          }));
          setKnowledgeBases(updatedKnowledgeBases);
        } else {
          setKnowledgeBases(bases);
        }

        setModelConfigs(modelConfigsResponse);
        updateVlmModelConfig(node.id, (prev) => ({
          ...prev,
          ...selected,
        }));
      } catch (error) {
        console.error(
          "Error fetching knowledge base and model configs:",
          error
        );
      }
    }
  }, [user, node.data.modelConfig?.modelId, updateVlmModelConfig, node.id]); // Add dependencies used in the function

  useEffect(() => {
    if (visible) {
      fetchKnowledgeBasesAndAllModelConfig();
    }
  }, [visible, fetchKnowledgeBasesAndAllModelConfig]);

  // 处理模型选择变化
  const handleModelChange = (value: string) => {
    const selected = modelConfigs.find((m) => m.modelId === value);
    if (selected) {
      updateVlmModelConfig(node.id, selected);
      const updatedKnowledgeBases = knowledgeBases.map((kb) => ({
        ...kb,
        selected: selected?.baseUsed.some((bu) => bu.baseId === kb.id),
      }));
      setKnowledgeBases(updatedKnowledgeBases);
    }
  };

  const handleBaseToggle = (id: string) => {
    setKnowledgeBases((bases) =>
      bases.map((base) =>
        base.id === id ? { ...base, selected: !base.selected } : base
      )
    );
  };

  const handleSubmit = () => {
    if (node.data.modelConfig) {
      const selectedIds = knowledgeBases
        .filter((base) => base.selected)
        .map((base) => base.id);
      const selectedNames = knowledgeBases
        .filter((base) => base.selected)
        .map((base) => base.name);

      // 直接构造新的 modelConfig
      const newModelConfig = {
        ...node.data.modelConfig,
        baseUsed: selectedIds.map((item, index) => ({
          name: selectedNames[index],
          baseId: item,
        })),
      };

      // 更新状态
      updateVlmModelConfig(node.id, newModelConfig);

      // 传递最新计算的值
      onSave(newModelConfig);
      setVisible(false);
    }
  };

  const onClose = () => {
    setVisible(false);
    fetchKnowledgeBasesAndAllModelConfig();
  };

  const onDeleteConfig = async (modelId: string) => {
    if (user?.name) {
      try {
        setModelConfigs((prev) => {
          const filter = prev.filter((item) => item.modelId !== modelId);
          return filter;
        });
        await deleteModelConfig(user.name, modelId);
      } catch (error) {
        console.error(
          "Error fetching knowledge base and model configs:",
          error
        );
      }
    }
  };

  const handleDeleteConfig = (config: ModelConfig) => {
    setShowConfirmDeleteConfig({ config }); // 显示单个对话框
  };

  const confirmDeleteConfig = () => {
    if (showConfirmDeleteConfig) {
      onDeleteConfig(showConfirmDeleteConfig.config.modelId);
      setShowConfirmDeleteConfig(null); // 关闭对话框
    }
  };

  const cancelDeleteConfig = () => {
    if (showConfirmDeleteConfig) {
      setShowConfirmDeleteConfig(null); // 关闭对话框
    }
  };

  // 创建知识库校验
  const handleCreateConfirm = async () => {
    if (!newModelName.trim()) {
      setNameError("Model name can not be null!");
      return;
    }
    if (
      modelConfigs.some(
        (modelConfig) => node.data.modelConfig?.modelName === newModelName
      )
    ) {
      setNameError("Model name already exist!");
      return;
    }

    if (user?.name && node.data.modelConfig) {
      try {
        const Newmodel: ModelConfig = {
          ...node.data.modelConfig,
          modelName: newModelName,
        };
        const response = await addModelConfig(user.name, Newmodel);
        updateVlmModelConfig(node.id, {
          ...Newmodel,
          modelId: response.data.model_id,
        });
        setModelConfigs((prevModelConfig: ModelConfig[]) => {
          return [
            ...prevModelConfig,
            {
              ...Newmodel,
              modelId: response.data.model_id,
            },
          ];
        });
        setShowAddLLM(false);
        setNewModelName("");
        setNameError(null);
        //const response = await createKnowledgeBase(user.name, newBaseName);
      } catch (error) {
        console.error("Error add LLM engine:", error);
      }
    }
    //fetchKnowledgeBasesAndAllModelConfig();
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-3xl px-10 py-6 w-[40%]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-5"
            >
              <path
                fillRule="evenodd"
                d="M10 1c3.866 0 7 1.79 7 4s-3.134 4-7 4-7-1.79-7-4 3.134-4 7-4Zm5.694 8.13c.464-.264.91-.583 1.306-.952V10c0 2.21-3.134 4-7 4s-7-1.79-7-4V8.178c.396.37.842.688 1.306.953C5.838 10.006 7.854 10.5 10 10.5s4.162-.494 5.694-1.37ZM3 13.179V15c0 2.21 3.134 4 7 4s7-1.79 7-4v-1.822c-.396.37-.842.688-1.306.953-1.532.875-3.548 1.369-5.694 1.369s-4.162-.494-5.694-1.37A7.009 7.009 0 0 1 3 13.179Z"
                clipRule="evenodd"
                transform="translate(0, -0.5)"
              />
            </svg>
            <span className="text-lg font-semibold">Config Knowledge Base</span>
          </div>
          <a
            href="/knowledge-base" // 配置页面的路由路径
            className="px-3 py-2 text-indigo-500 hover:text-indigo-700 text-base flex items-center cursor-pointer"
            target="_blank" // 新窗口打开
            rel="noopener noreferrer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Add Knowledge-Base
          </a>
        </div>

        <p className="text-gray-500 text-sm mb-2 flex">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="size-4 mr-[2px] my-auto"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
            />
          </svg>
          Tutorials: Click top-right
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="mx-1 size-5 my-auto"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
          icon
        </p>

        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto px-2  max-h-[50vh]">
          {/* 知识库选择（添加滚动） */}

          <div className="pt-2">
            <details className="group" open>
              <summary className="flex items-center cursor-pointer text-sm font-medium">
                LLM Settings
                <svg
                  className="ml-1 w-4 h-4 transition-transform group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </summary>

              <div className="mt-2 space-y-4 pb-2">
                {/* 新增模型选择器 */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium mb-2">
                      LLM Engine
                    </label>
                    <div
                      onClick={() => setShowAddLLM(true)}
                      className="px-3 py-2 text-indigo-500 hover:text-indigo-700 text-sm flex items-center cursor-pointer"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 mr-1"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      Add New Configuration
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div ref={ref} className="relative w-full">
                      {/* 自定义触发按钮 */}
                      <div
                        onClick={() => setShowDropdown(!showDropdown)}
                        className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl cursor-pointer bg-white flex items-center justify-between hover:border-indigo-500 transition-colors"
                      >
                        <span className="text-gray-700">
                          {node.data.modelConfig?.modelName}
                        </span>
                        <svg
                          className={`w-5 h-5 text-gray-400 transform transition-transform ${
                            showDropdown ? "rotate-180" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>

                      {/* 自定义下拉框 */}
                      {showDropdown && (
                        <div className="p-1 absolute w-full mt-1 bg-white border border-gray-200 rounded-3xl shadow-lg z-50 overflow-hidden">
                          <div className="max-h-60 overflow-y-auto">
                            {modelConfigs.map((model) => (
                              <div
                                key={model.modelId}
                                onClick={() => {
                                  handleModelChange(model.modelId);
                                  setShowDropdown(false);
                                }}
                                className="px-4 py-2 cursor-pointer rounded-3xl transition-colors hover:bg-gray-200"
                              >
                                <div className="w-full flex gap-1 items-center justify-between">
                                  {model.modelName}
                                  {model.modelId ===
                                  node.data.modelConfig?.modelId ? (
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                      className="size-4"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  ) : (
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                      className="size-4 text-indigo-500 hover:text-indigo-700"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        return handleDeleteConfig(model);
                                      }}
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 新增模型地址和API Key */}
                <div>
                  <label className="block text-sm font-medium">LLM Url</label>
                  <input
                    type="url"
                    value={node.data.modelConfig?.modelURL}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        modelURL: e.target.value,
                      }))
                    }
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    placeholder="https://api.example.com/v1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">API Key</label>
                  <input
                    type="password"
                    value={node.data.modelConfig?.apiKey}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        apiKey: e.target.value,
                      }))
                    }
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    placeholder="sk-xxxxxxxx"
                  />
                </div>
              </div>
            </details>
          </div>
          <div className="pt-2">
            <details className="group" open>
              <summary className="flex items-center cursor-pointer text-sm font-medium">
                Choose DB
                <svg
                  className="ml-1 w-4 h-4 transition-transform group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </summary>

              <div className="py-2 grid grid-cols-2 gap-3 mt-2">
                {knowledgeBases.map((base) => (
                  <label
                    key={base.id}
                    className="overflow-auto relative inline-flex items-center group px-3 py-2 border border-gray-200 rounded-3xl hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={base.selected}
                      onChange={() => handleBaseToggle(base.id)}
                      className="shrink-0 appearance-none h-5 w-5 border-2 border-gray-300 rounded-3xl transition-colors checked:bg-indigo-500 checked:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-200"
                    />
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="absolute size-4 text-white shrink-0"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                        transform="translate(2.8, 1)"
                      />
                    </svg>
                    <div className="ml-2 flex gap-1 items-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="size-4 shrink-0"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 1c3.866 0 7 1.79 7 4s-3.134 4-7 4-7-1.79-7-4 3.134-4 7-4Zm5.694 8.13c.464-.264.91-.583 1.306-.952V10c0 2.21-3.134 4-7 4s-7-1.79-7-4V8.178c.396.37.842.688 1.306.953C5.838 10.006 7.854 10.5 10 10.5s4.162-.494 5.694-1.37ZM3 13.179V15c0 2.21 3.134 4 7 4s7-1.79 7-4v-1.822c-.396.37-.842.688-1.306.953-1.532.875-3.548 1.369-5.694 1.369s-4.162-.494-5.694-1.37A7.009 7.009 0 0 1 3 13.179Z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>{base.name}</span>
                    </div>
                  </label>
                ))}
              </div>
            </details>
          </div>

          {/* 高级选项 */}
          <div className="pt-2">
            <details className="group" open>
              <summary className="flex items-center cursor-pointer text-sm font-medium">
                Advanced Settings
                <svg
                  className="ml-1 w-4 h-4 transition-transform group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </summary>

              <div className="mt-2 space-y-4 pb-2">
                {/* 新增模型选择器 */}
                {/* Temperature */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">
                      Temperature
                      <span className="text-xs text-gray-500 ml-1">(0-1)</span>
                    </label>
                    <label className="relative inline-flex items-center group p-2 rounded-3xl hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={node.data.modelConfig?.useTemperatureDefault}
                        onChange={(e) =>
                          updateVlmModelConfig(node.id, (prev) => ({
                            ...prev,
                            useTemperatureDefault: e.target.checked,
                          }))
                        }
                        className="appearance-none h-5 w-5 border-2 border-gray-300 rounded-3xl transition-colors checked:bg-indigo-500 checked:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-200"
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="absolute size-4 text-white"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                          transform="translate(2.8, 1)"
                        />
                      </svg>
                      <span className="text-sm text-gray-600 ml-2">
                        Use Model Default
                      </span>
                    </label>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={node.data.modelConfig?.temperature}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        temperature: parseFloat(e.target.value),
                      }))
                    }
                    disabled={node.data.modelConfig?.useTemperatureDefault}
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>

                {/* Max Token */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">
                      Max Token
                      <span className="text-xs text-gray-500 ml-1">
                        (1024-1048576)
                      </span>
                    </label>
                    <label className="relative inline-flex items-center group p-2 rounded-3xl hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={node.data.modelConfig?.useMaxLengthDefault}
                        onChange={(e) =>
                          updateVlmModelConfig(node.id, (prev) => ({
                            ...prev,
                            useMaxLengthDefault: e.target.checked,
                          }))
                        }
                        className="appearance-none h-5 w-5 border-2 border-gray-300 rounded-3xl transition-colors checked:bg-indigo-500 checked:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-200"
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="absolute size-4 text-white"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                          transform="translate(2.8, 1)"
                        />
                      </svg>
                      <span className="text-sm text-gray-600 ml-2">
                        Use Model Default
                      </span>
                    </label>
                  </div>
                  <input
                    type="number"
                    min="1024"
                    max="1048576"
                    value={node.data.modelConfig?.maxLength}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        maxLength: parseInt(e.target.value),
                      }))
                    }
                    disabled={node.data.modelConfig?.useMaxLengthDefault}
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>

                {/* Top-P */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">
                      Top-P
                      <span className="text-xs text-gray-500 ml-1">(0-1)</span>
                    </label>
                    <label className="relative inline-flex items-center group p-2 rounded-3xl hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={node.data.modelConfig?.useTopPDefault}
                        onChange={(e) =>
                          updateVlmModelConfig(node.id, (prev) => ({
                            ...prev,
                            useTopPDefault: e.target.checked,
                          }))
                        }
                        className="appearance-none h-5 w-5 border-2 border-gray-300 rounded-3xl transition-colors checked:bg-indigo-500 checked:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-200"
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="absolute size-4 text-white"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                          transform="translate(2.8, 1)"
                        />
                      </svg>
                      <span className="text-sm text-gray-600 ml-2">
                        Use Model Default
                      </span>
                    </label>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={node.data.modelConfig?.topP}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        topP: parseFloat(e.target.value),
                      }))
                    }
                    disabled={node.data.modelConfig?.useTopPDefault}
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
                {/* Knowledge-Base Top-K */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">
                      Knowledge-Base Top-K
                      <span className="text-xs text-gray-500 ml-1">(1-30)</span>
                    </label>
                    <label className="relative inline-flex items-center group p-2 rounded-3xl hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={node.data.modelConfig?.useTopKDefault}
                        onChange={(e) =>
                          updateVlmModelConfig(node.id, (prev) => ({
                            ...prev,
                            useTopKDefault: e.target.checked,
                          }))
                        }
                        className="appearance-none h-5 w-5 border-2 border-gray-300 rounded-3xl transition-colors checked:bg-indigo-500 checked:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-200"
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="absolute size-4 text-white"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                          transform="translate(2.8, 1)"
                        />
                      </svg>
                      <span className="text-sm text-gray-600 ml-2">
                        Use Model Default
                      </span>
                    </label>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    step="1"
                    value={node.data.modelConfig?.topK}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        topK: parseInt(e.target.value),
                      }))
                    }
                    disabled={node.data.modelConfig?.useTopKDefault}
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
                {/* Retrieval Score Threshold */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">
                      Retrieval Score Threshold
                      <span className="text-xs text-gray-500 ml-1">(0-20)</span>
                    </label>
                    <label className="relative inline-flex items-center group p-2 rounded-3xl hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={
                          node.data.modelConfig?.useScoreThresholdDefault
                        }
                        onChange={(e) =>
                          updateVlmModelConfig(node.id, (prev) => ({
                            ...prev,
                            useScoreThresholdDefault: e.target.checked,
                          }))
                        }
                        className="appearance-none h-5 w-5 border-2 border-gray-300 rounded-3xl transition-colors checked:bg-indigo-500 checked:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-200"
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="absolute size-4 text-white"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                          transform="translate(2.8, 1)"
                        />
                      </svg>
                      <span className="text-sm text-gray-600 ml-2">
                        Use Model Default
                      </span>
                    </label>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="1"
                    value={node.data.modelConfig?.scoreThreshold}
                    onChange={(e) =>
                      updateVlmModelConfig(node.id, (prev) => ({
                        ...prev,
                        scoreThreshold: parseInt(e.target.value),
                      }))
                    }
                    disabled={node.data.modelConfig?.useScoreThresholdDefault}
                    className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-3xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
              </div>
            </details>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-2 flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2  text-gray-700 border border-gray-300 rounded-full hover:bg-gray-100 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-indigo-500 text-white rounded-full hover:bg-indigo-700 cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
      {showAddLLM && (
        <AddLLMEngine
          setShowAddLLM={setShowAddLLM}
          nameError={nameError}
          setNameError={setNameError}
          newModelName={newModelName}
          setNewModelName={setNewModelName}
          onCreateConfirm={handleCreateConfirm}
        />
      )}
      {/* 确认删除单个模型配置 */}
      {showConfirmDeleteConfig && (
        <ConfirmDialog
          message={`Confirm the deletion of model config "${showConfirmDeleteConfig.config.modelName.slice(
            0,
            30
          )}"`}
          onConfirm={confirmDeleteConfig}
          onCancel={cancelDeleteConfig}
        />
      )}
    </div>
  );
};

export default KnowledgeConfigModal;

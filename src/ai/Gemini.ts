import type {Tool} from '../agent/Tool';

import {GeminiOptions} from './AIOptions';
import {GeminiResponse} from './AITypes';
import {BaseAIModel} from './BaseAIModel';

// Proxy server configuration
const PROXY_SERVER_URL = 'https://dev.ugboly.com:443';
// const PROXY_SERVER_URL = 'https://localhost:8080';

export interface GeminiQueryInput {
  type: 'live' | 'text' | 'uri' | 'base64' | 'multiPart';
  action?: 'start' | 'stop' | 'send';
  text?: string;
  uri?: string;
  base64?: string;
  mimeType?: string;
  parts?: any[];
  config?: any;
  data?: any;
}

interface ProxyResponse {
  success: boolean;
  response?: any;
  status?: any;
  error?: string;
  message?: string;
  sessionId?: string;
}

export class Gemini extends BaseAIModel {
  inited = false;
  liveSessionId?: string;
  isLiveMode = false;
  liveCallbacks: any = {};

  constructor(protected options: GeminiOptions) {
    super();
  }

  async init() {
    this.inited = true;
    console.log('Gemini client initialized to use proxy server');
  }

  isAvailable() {
    return this.inited;
  }

  isLiveAvailable() {
    return this.isAvailable();
  }

  /**
   * 向代理服务器发送HTTP请求
   */
  private async proxyRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: any
  ): Promise<ProxyResponse> {
    const url = `${PROXY_SERVER_URL}${endpoint}`;
    
    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (body && method === 'POST') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`❌ Proxy request failed [${endpoint}]:`, error);
      throw error;
    }
  }

  /**
   * 启动Live Session
   */
  async startLiveSession(
    params: any = {},
    model = 'gemini-2.5-flash-native-audio-preview-09-2025'
  ) {
    if (!this.isLiveAvailable()) {
      throw new Error('Live API not available.');
    }

    if (this.liveSessionId) {
      console.log('Live session already exists:', this.liveSessionId);
      return {id: this.liveSessionId};
    }

    // 生成唯一的session ID
    this.liveSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const defaultConfig = {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Aoede'}},
      },
      outputAudioTranscription: {},
      inputAudioTranscription: {},
      ...params,
    };

    try {
      const result = await this.proxyRequest('/api/gemini/live/connect', 'POST', {
        sessionId: this.liveSessionId,
        model,
        config: defaultConfig,
      });

      if (result.success) {
        this.isLiveMode = true;
        console.log('🔴 Live session opened:', this.liveSessionId);
        
        // 触发回调
        if (this.liveCallbacks?.onopen) {
          this.liveCallbacks.onopen();
        }

        return {id: this.liveSessionId};
      } else {
        throw new Error(result.error || 'Failed to create live session');
      }
    } catch (error) {
      console.error('❌ Failed to start live session:', error);
      this.liveSessionId = undefined;
      throw error;
    }
  }

  /**
   * 停止Live Session
   */
  async stopLiveSession() {
    if (!this.liveSessionId) {
      return;
    }

    try {
      await this.proxyRequest('/api/gemini/live/close', 'POST', {
        sessionId: this.liveSessionId,
      });

      console.log('🔒 Live session closed:', this.liveSessionId);

      // 触发回调
      if (this.liveCallbacks?.onclose) {
        this.liveCallbacks.onclose({reason: 'Client closed'});
      }
    } catch (error) {
      console.error('❌ Error closing live session:', error);
    } finally {
      this.liveSessionId = undefined;
      this.isLiveMode = false;
    }
  }

  /**
   * 设置Live Session回调
   */
  setLiveCallbacks(callbacks: any) {
    this.liveCallbacks = callbacks;
  }

  /**
   * 发送工具响应
   */
  sendToolResponse(response: any) {
    if (!this.liveSessionId) {
      console.warn('No active live session');
      return;
    }

    console.debug('Sending tool response to gemini:', response);

    this.proxyRequest('/api/gemini/live/tool-response', 'POST', {
      sessionId: this.liveSessionId,
      response,
    }).catch((error) => {
      console.error('❌ Error sending tool response:', error);
      if (this.liveCallbacks?.onerror) {
        this.liveCallbacks.onerror(error);
      }
    });
  }

  /**
   * 发送实时输入
   */
  sendRealtimeInput(input: any) {
    if (!this.liveSessionId) {
      console.warn('No active live session');
      return;
    }

    try {
      this.proxyRequest('/api/gemini/live/send', 'POST', {
        sessionId: this.liveSessionId,
        input,
      }).catch((error) => {
        console.error('❌ Error sending realtime input:', error);
        if (this.liveCallbacks?.onerror) {
          this.liveCallbacks.onerror(error);
        }
      });
    } catch (error) {
      console.error('❌ Error sending realtime input:', error);
      throw error;
    }
  }

  /**
   * 获取Live Session状态
   */
  async getLiveSessionStatus() {
    if (!this.liveSessionId) {
      return {
        isActive: false,
        hasSession: false,
        isAvailable: this.isLiveAvailable(),
      };
    }

    try {
      const result = await this.proxyRequest(
        `/api/gemini/live/status/${this.liveSessionId}`,
        'GET'
      );

      if (result.success && result.status) {
        return result.status;
      }
    } catch (error) {
      console.error('❌ Error getting session status:', error);
    }

    return {
      isActive: this.isLiveMode,
      hasSession: !!this.liveSessionId,
      isAvailable: this.isLiveAvailable(),
    };
  }

  /**
   * 主查询方法
   */
  async query(
    input: GeminiQueryInput | {prompt: string},
    _tools: Tool[] = []
  ): Promise<GeminiResponse | null> {
    if (!this.inited) {
      console.warn('Gemini not initialized.');
      return null;
    }

    const options = this.options;
    const config = options.config || {};

    // 处理简单的prompt请求
    if (!('type' in input)) {
      try {
        const result = await this.proxyRequest('/api/gemini/generate', 'POST', {
          model: options.model,
          contents: input.prompt!,
          config: config,
        });

        if (result.success && result.response) {
          return {text: result.response.text || null};
        }

        return {text: null};
      } catch (error) {
        console.error('❌ Query error:', error);
        return null;
      }
    }

    // 处理不同类型的输入
    let contents: any;
    
    switch (input.type) {
      case 'text':
        contents = input.text!;
        break;

      case 'base64':
        contents = {
          inlineData: {
            mimeType: input.mimeType || 'image/png',
            data: input.base64,
          },
        };
        break;

      case 'uri':
        // 对于URI类型，需要转换为适合代理的格式
        contents = [
          {
            fileData: {
              fileUri: input.uri!,
              mimeType: input.mimeType!,
            },
          },
          {text: input.text!},
        ];
        break;

      case 'multiPart':
        contents = [{role: 'user', parts: input.parts}];
        break;

      default:
        console.warn('Unsupported input type:', input.type);
        return null;
    }

    try {
      const result = await this.proxyRequest('/api/gemini/generate', 'POST', {
        model: this.options.model,
        contents,
        config: this.options.config || {},
      });

      if (!result.success || !result.response) {
        return {text: null};
      }

      const response = result.response;

      // 检查是否有函数调用
      if (response.functionCalls && response.functionCalls.length > 0) {
        const toolCall = response.functionCalls[0];
        if (toolCall && toolCall.name) {
          return {
            toolCall: {
              name: toolCall.name,
              args: toolCall.args,
            },
          };
        }
      }

      return {text: response.text || null};
    } catch (error) {
      console.error('❌ Query error:', error);
      return null;
    }
  }

  /**
   * 生成图像
   */
  async generate(
    prompt: string | string[],
    type: 'image' = 'image',
    systemInstruction = 'Generate an image',
    model = 'gemini-2.5-flash-image-preview'
  ) {
    if (!this.isAvailable()) return;

    let contents: any;

    if (Array.isArray(prompt)) {
      contents = prompt.map((item) => {
        if (typeof item === 'string') {
          if (item.startsWith('data:image/')) {
            const [header, data] = item.split(',');
            const mimeType = header.split(';')[0].split(':')[1];
            return {inlineData: {mimeType, data}};
          } else {
            return {text: item};
          }
        }
        // 假设其他项已经是有效的Part对象
        return item;
      });
    } else {
      contents = prompt;
    }

    try {
      const result = await this.proxyRequest('/api/gemini/generate', 'POST', {
        model,
        contents,
        systemInstruction,
      });

      if (result.success && result.response?.candidates) {
        const firstCandidate = result.response.candidates[0];
        
        for (const part of firstCandidate?.content?.parts || []) {
          if (type === 'image' && part.inlineData) {
            return 'data:image/png;base64,' + part.inlineData.data;
          }
        }
      }
    } catch (error) {
      console.error('❌ Generate error:', error);
    }

    return undefined;
  }
}

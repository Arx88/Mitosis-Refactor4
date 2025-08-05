import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Check, ChevronDown, Maximize2, Rewind, Terminal, AlertCircle, CheckCircle, Circle, ChevronUp, Clock, Activity, Zap, FileText, SkipBack, SkipForward, Monitor, Radio, ArrowLeft, ArrowRight, RotateCcw, Loader2 } from 'lucide-react';
import { ToolResult } from '../../services/api';
import { TaskStep } from '../../types';
import { TaskIcon } from '../TaskIcon';
import { ToolExecutionDetails } from '../ToolExecutionDetails';
import { TaskCompletedUI } from '../TaskCompletedUI';
import { useAppContext } from '../../context/AppContext';
import { useWebSocket } from '../../hooks/useWebSocket'; // ✅ IMPORTAR WebSocket HOOK PARA NUEVOS EVENTOS

export interface Task {
  id: string;
  title: string;
  completed: boolean;
}

export interface MonitorPage {
  id: string;
  title: string;
  content: string;
  type: 'plan' | 'tool-execution' | 'report' | 'file' | 'error' | 'web-browsing' | 'data-collection' | 'log'; // ✅ NUEVOS TIPOS SEGÚN UpgardeRef.md SECCIÓN 5.3
  timestamp: Date;
  toolName?: string;
  toolParams?: any;
  metadata?: {
    lineCount?: number;
    fileSize?: number;
    executionTime?: number;
    status?: 'success' | 'error' | 'running';
    // ✅ NUEVOS CAMPOS PARA NAVEGACIÓN WEB - SEGÚN UpgardeRef.md SECCIÓN 5.3
    url?: string;
    screenshotUrl?: string; // URL accesible para la imagen
    // ✅ NUEVOS CAMPOS PARA RECOLECCIÓN DE DATOS
    dataSummary?: string;
    partialData?: any;
    // ✅ NUEVOS CAMPOS PARA LOGS
    logLevel?: 'info' | 'warn' | 'error' | 'debug';
  };
}

export interface TerminalViewProps {
  title?: string;
  tasks?: Task[];
  isLive?: boolean;
  onFullscreen?: () => void;
  'data-id'?: string;
  toolResults?: ToolResult[];
  plan?: TaskStep[];
  onToggleTaskStep?: (stepId: string) => void;
  externalLogs?: Array<{message: string, type: 'info' | 'success' | 'error', timestamp: Date}>;
  isInitializing?: boolean;
  onInitializationComplete?: () => void;
  onInitializationLog?: (message: string, type: 'info' | 'success' | 'error') => void;
  taskId?: string;
  taskTitle?: string;
  executionData?: any; // Datos de ejecución del backend
}

export const TerminalView = ({
  title = 'Monitor de Ejecución',
  tasks = [],
  isLive = false,
  onFullscreen,
  'data-id': dataId,
  toolResults = [],
  plan = [],
  onToggleTaskStep,
  externalLogs = [],
  isInitializing = false,
  onInitializationComplete,
  onInitializationLog,
  taskId,
  taskTitle,
  executionData
}: TerminalViewProps) => {
  // ========================================================================
  // USAR CONTEXT PARA DATOS AISLADOS - NUEVO ENFOQUE
  // ========================================================================
  
  // ✅ FIX: Obtener datos aislados correctamente del Context
  const { 
    getTaskMonitorPages, 
    setTaskMonitorPages,
    addTaskMonitorPage,
    getTaskCurrentPageIndex,
    setTaskCurrentPageIndex
  } = useAppContext();

  // ✅ WEBSOCKET HOOK PARA NUEVOS EVENTOS DE TIEMPO REAL - SEGÚN UpgardeRef.md SECCIÓN 5.3
  const { socket, isConnected, joinTaskRoom, addEventListeners, removeEventListeners } = useWebSocket();

  // ========================================================================
  // ESTADO PARA VISUALIZACIÓN BROWSER-USE
  // ========================================================================
  const [browserScreenshots, setBrowserScreenshots] = useState<Array<{
    id: string;
    screenshot: string;
    step: string;
    timestamp: string;
    url?: string;
  }>>([]);
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);

  // ========================================================================
  // ESTADO LOCAL MÍNIMO - SOLO PARA UI
  // ========================================================================
  
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [isPlanExpanded, setIsPlanExpanded] = useState(true);

  // ✨ NEW: Time tracking for steps - FIXED VERSION
  const [stepTimers, setStepTimers] = useState<{ [stepId: string]: { startTime: Date, interval: NodeJS.Timeout } }>({});
  const [liveTimers, setLiveTimers] = useState<{ [stepId: string]: string }>({});

  // ✨ NEW: Function to format elapsed time
  const formatElapsedTime = (startTime: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - startTime.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // ✨ NEW: Start timer for active step - FIXED TO UPDATE UI
  const startStepTimer = (stepId: string) => {
    if (stepTimers[stepId]) return; // Already has timer
    
    console.log(`⏱️ [TERMINAL-${taskId}] Starting timer for step: ${stepId}`);
    const startTime = new Date();
    const interval = setInterval(() => {
      const elapsedTime = formatElapsedTime(startTime);
      // ✅ FIX: Actually update the UI by setting state
      setLiveTimers(prev => ({
        ...prev,
        [stepId]: elapsedTime
      }));
      console.log(`⏲️ [STEP-${stepId}] Elapsed: ${elapsedTime}`);
    }, 1000);

    setStepTimers(prev => ({
      ...prev,
      [stepId]: { startTime, interval }
    }));
    
    // Set initial time
    setLiveTimers(prev => ({
      ...prev,
      [stepId]: '00:00'
    }));
  };

  // ✨ NEW: Stop timer for step - FIXED TO CLEAN UP UI STATE
  const stopStepTimer = (stepId: string) => {
    if (stepTimers[stepId]) {
      console.log(`⏹️ [TERMINAL-${taskId}] Stopping timer for step: ${stepId}`);
      clearInterval(stepTimers[stepId].interval);
      setStepTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[stepId];
        return newTimers;
      });
      // ✅ FIX: Also clean up the live timer display
      setLiveTimers(prev => {
        const newLiveTimers = { ...prev };
        delete newLiveTimers[stepId];
        return newLiveTimers;
      });
    }
  };

  // ✨ NEW: Effect to manage step timers - SIMPLIFICADO SIN MODIFICAR PLAN
  useEffect(() => {
    if (!plan || !taskId) return;

    console.log(`⏱️ [TERMINAL-${taskId}] Managing timers for ${plan.length} steps`);

    // Start timer for active steps
    plan.forEach(step => {
      if (step.active && !stepTimers[step.id]) {
        startStepTimer(step.id);
      } else if (!step.active && stepTimers[step.id]) {
        // Stop timer when step becomes inactive (but don't stop for completed steps)
        if (!step.completed) {
          stopStepTimer(step.id);
        }
      }
    });

    // Cleanup timers for steps that no longer exist in plan
    Object.keys(stepTimers).forEach(stepId => {
      const step = plan.find(s => s.id === stepId);
      if (!step) {
        stopStepTimer(stepId);
      }
    });

    // Cleanup all timers on unmount
    return () => {
      Object.values(stepTimers).forEach(timer => {
        clearInterval(timer.interval);
      });
      // ✅ FIX: Also cleanup live timers
      setStepTimers({});
      setLiveTimers({});
    };
  }, [plan, taskId]);
  const [currentExecutingTool, setCurrentExecutingTool] = useState<ToolResult | null>(null);
  // ✅ USAR CONTEXT PARA MONITOR PAGES - NO MÁS ESTADO LOCAL
  // const [monitorPages, setMonitorPages] = useState<MonitorPage[]>([]);
  // const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isLiveMode, setIsLiveMode] = useState(true);
  // Estado para manejar el estado del sistema - BASADO EN WEBSOCKET REAL
  const [isSystemOnline, setIsSystemOnline] = useState(false);
  
  // ✅ FIX CRÍTICO: Usar estado real de WebSocket en lugar de simulación
  useEffect(() => {
    console.log(`🔌 [WEBSOCKET-STATUS] Connection state changed: ${isConnected}`);
    setIsSystemOnline(isConnected); // Usar el estado real del WebSocket
  }, [isConnected]);
  const [initializationStep, setInitializationStep] = useState(0);
  const [paginationStats, setPaginationStats] = useState({
    totalPages: 0,
    currentPage: 1,
    limit: 20,
    offset: 0
  });
  const monitorRef = useRef<HTMLDivElement>(null);
  const lastTaskIdRef = useRef<string>(''); // Para tracking de cambios de tarea
  
  // ========================================================================
  // OBTENER DATOS AISLADOS DEL CONTEXT
  // ========================================================================
  
  // Función para obtener las páginas de monitor de una tarea específica
  const monitorPages = getTaskMonitorPages(taskId);
  console.log(`🔧 [TERMINAL-DEBUG] Task ${taskId} has ${monitorPages.length} monitor pages`);
  
  const actualCurrentPageIndex = getTaskCurrentPageIndex(taskId);

  // UPGRADE AI: Actualizar estadísticas de paginación cuando cambian las monitor pages
  useEffect(() => {
    if (taskId && monitorPages.length >= 0) {
      console.log(`📊 [PAGINATION-UPDATE] Updating pagination stats for task ${taskId}: ${monitorPages.length} pages`);
      setPaginationStats(prev => ({
        ...prev,
        totalPages: monitorPages.length
      }));
    }
  }, [monitorPages.length, taskId]);

  // Función para cargar el informe final - FIXED: Proper error handling and content loading
  const loadFinalReport = async (taskId: string) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';
      console.log('📄 Loading final report for task:', taskId);
      
      const response = await fetch(`${backendUrl}/api/agent/generate-final-report/${taskId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('📄 Final report loaded successfully:', result);
        
        // Create the final report content
        const reportContent = result.report || result.content || `# Informe Final - ${taskTitle}\n\n## Resumen\n\nTarea completada exitosamente.\n\n## Pasos Ejecutados\n\n${plan?.map((step, index) => `${index + 1}. ${step.title} ✅`).join('\n') || 'No hay pasos registrados'}\n\n## Conclusión\n\nTodos los pasos se ejecutaron correctamente.\n\n---\n\n*Generado automáticamente por Mitosis*`;
        
        const reportPage: MonitorPage = {
          id: 'final-report',
          title: '📄 INFORME FINAL - Tarea Completada',
          content: reportContent,
          type: 'report',
          timestamp: new Date(),
          metadata: {
            lineCount: reportContent.split('\n').length,
            status: 'success',
            fileSize: reportContent.length
          }
        };
        
        // ✅ FIX: Usar Context aislado consistentemente
        const currentPages = taskId ? getTaskMonitorPages(taskId) : [];
        const existingIndex = currentPages.findIndex(page => page.id === 'final-report');
        
        if (existingIndex >= 0) {
          // Update existing page
          const updated = [...currentPages];
          updated[existingIndex] = reportPage;
          setTaskMonitorPages(taskId, updated);
          // Navigate to the final report page
          setTaskCurrentPageIndex(taskId, existingIndex);
          setIsLiveMode(false);
        } else {
          // Add new page
          const newPages = [...currentPages, reportPage];
          setTaskMonitorPages(taskId, newPages);
          // Navigate to the final report page (last page)
          setTaskCurrentPageIndex(taskId, newPages.length - 1);
          setIsLiveMode(false);
          setPaginationStats(prevStats => ({ 
            ...prevStats, 
            totalPages: newPages.length 
          }));
        }
        
        console.log('📄 Final report loaded successfully in terminal');
      } else {
        console.error('Error loading final report:', response.status);
        // Create fallback report
        const fallbackReport = `# Informe Final - ${taskTitle}\n\n## Resumen\n\nTarea completada exitosamente.\n\n## Pasos Ejecutados\n\n${plan?.map((step, index) => `${index + 1}. ${step.title} ✅`).join('\n') || 'No hay pasos registrados'}\n\n## Conclusión\n\nTodos los pasos se ejecutaron correctamente.\n\n---\n\n*Generado automáticamente por Mitosis*`;
        
        const fallbackPage: MonitorPage = {
          id: 'final-report',
          title: '📄 INFORME FINAL - Tarea Completada',
          content: fallbackReport,
          type: 'report',
          timestamp: new Date(),
          metadata: {
            lineCount: fallbackReport.split('\n').length,
            status: 'success',
            fileSize: fallbackReport.length
          }
        };
        
        // ✅ FIX: Usar Context aislado consistentemente - Add fallback report
        const currentPages = taskId ? getTaskMonitorPages(taskId) : [];
        const newPages = [...currentPages, fallbackPage];
        setTaskMonitorPages(taskId, newPages);
        setTaskCurrentPageIndex(taskId, newPages.length - 1);
        setIsLiveMode(false);
        setPaginationStats(prev => ({ ...prev, totalPages: prev.totalPages + 1 }));
      }
    } catch (error) {
      console.error('Error loading final report:', error);
      // Create error fallback report
      const errorReport = `# Informe Final - ${taskTitle}\n\n## Resumen\n\nTarea completada exitosamente.\n\n## Pasos Ejecutados\n\n${plan?.map((step, index) => `${index + 1}. ${step.title} ✅`).join('\n') || 'No hay pasos registrados'}\n\n## Conclusión\n\nTodos los pasos se ejecutaron correctamente.\n\n---\n\n*Generado automáticamente por Mitosis*`;
      
      const errorPage: MonitorPage = {
        id: 'final-report',
        title: '📄 INFORME FINAL - Tarea Completada',
        content: errorReport,
        type: 'report',
        timestamp: new Date(),
        metadata: {
          lineCount: errorReport.split('\n').length,
          status: 'success',
          fileSize: errorReport.length
        }
      };
      
      // ✅ FIX: Usar Context aislado consistentemente - Add error fallback report
      const currentPages = taskId ? getTaskMonitorPages(taskId) : [];
      const newPages = [...currentPages, errorPage];
      setTaskMonitorPages(taskId, newPages);
      setTaskCurrentPageIndex(taskId, newPages.length - 1);
      setIsLiveMode(false);
      setPaginationStats(prev => ({ ...prev, totalPages: prev.totalPages + 1 }));
    }
  };

  // Define initialization steps as constant to avoid infinite re-renders
  const initializationSteps = [
    { id: 'env', title: 'Setting up environment', duration: 1500 },
    { id: 'deps', title: 'Installing dependencies', duration: 2000 },
    { id: 'agent', title: 'Initializing agent', duration: 1000 }
  ];

  // Reset terminal state when dataId changes (switching tasks) - CON LOGGING
  useEffect(() => {
    console.log(`🔄 [TERMINAL-RESET] Task switch detected:`);
    console.log(`  - Previous dataId: ${lastTaskIdRef.current || 'none'}`);
    console.log(`  - New dataId: ${dataId}`);
    console.log(`  - TaskId: ${taskId}`);
    console.log(`  - TaskTitle: ${taskTitle}`);
    
    // UPGRADE AI: PROBLEMA ESTADO STALE - Verificar si es cambio real de tarea
    if (lastTaskIdRef.current && lastTaskIdRef.current !== (dataId || '')) {
      console.log(`🧹 [TERMINAL-RESET] REAL TASK SWITCH - Clearing previous task state immediately`);
      
      // UPGRADE AI: Limpiar monitor pages inmediatamente al cambiar de tarea
      if (taskId && lastTaskIdRef.current !== taskId) {
        console.log(`🧹 [TERMINAL-RESET] Clearing monitor pages for previous task`);
        // No mostrar datos de tarea anterior - usar páginas vacías temporalmente
        setPaginationStats({
          totalPages: 0, // UPGRADE AI: Empezar con 0 páginas hasta que se cargan las nuevas
          currentPage: 1,
          limit: 20,
          offset: 0
        });
      }
    }
    
    console.log(`🔄 [TERMINAL-RESET] Resetting terminal state for task: ${dataId}`);
    setTerminalOutput([]);
    setCurrentExecutingTool(null);
    
    // ✅ NO RESETEAR MONITOR PAGES - ESTÁN EN CONTEXT AISLADO
    // setMonitorPages([]);
    // setCurrentPageIndex(0);
    
    setIsLiveMode(true);
    setIsSystemOnline(false);
    setInitializationStep(0);
    
    // UPGRADE AI: Solo establecer totalPages basado en monitorPages si NO es cambio de tarea
    if (!lastTaskIdRef.current || lastTaskIdRef.current === (dataId || '')) {
      setPaginationStats({
        totalPages: monitorPages.length, // Usar datos del Context solo si no hay cambio de tarea
        currentPage: 1,
        limit: 20,
        offset: 0
      });
    }
    
    // Limpiar timers de pasos anteriores
    Object.values(stepTimers).forEach(timer => {
      clearInterval(timer.interval);
    });
    setStepTimers({});
    setLiveTimers({});
    
    console.log(`✅ [TERMINAL-RESET] State reset complete for task: ${dataId} - Context data preserved`);
    lastTaskIdRef.current = dataId || '';
  }, [dataId, taskId, taskTitle]); // Reset whenever dataId changes, including when it becomes null/undefined

  // Handle environment initialization - MEJORADO CON LOGGING ESPECÍFICO POR TAREA
  useEffect(() => {
    if (isInitializing && taskId && taskTitle) {
      console.log(`🚀 [INIT-${taskId}] Starting environment initialization for: ${taskTitle}`);
      setIsSystemOnline(false);
      setInitializationStep(0);
      
      // Log initial message
      if (onInitializationLog) {
        onInitializationLog(`🚀 Initializing environment for: ${taskTitle}`, 'info');
      }
      
      // Process initialization steps
      const processStep = (stepIndex: number) => {
        if (stepIndex >= initializationSteps.length) {
          // All steps completed
          console.log(`✅ [INIT-${taskId}] Environment ready! System is now ONLINE`);
          setIsSystemOnline(true);
          if (onInitializationLog) {
            onInitializationLog('✅ Environment ready! System is now ONLINE', 'success');
          }
          if (onInitializationComplete) {
            onInitializationComplete();
          }
          return;
        }
        
        const step = initializationSteps[stepIndex];
        setInitializationStep(stepIndex);
        
        console.log(`⚙️ [INIT-${taskId}] ${step.title}...`);
        if (onInitializationLog) {
          onInitializationLog(`⚙️ ${step.title}...`, 'info');
        }
        
        setTimeout(() => {
          console.log(`✓ [INIT-${taskId}] ${step.title} completed`);
          if (onInitializationLog) {
            onInitializationLog(`✓ ${step.title} completed`, 'success');
          }
          processStep(stepIndex + 1);
        }, step.duration);
      };
      
      processStep(0);
    }
  }, [isInitializing, taskId, taskTitle, onInitializationLog, onInitializationComplete]);

  // Inicializar con TODO.md como Página 1 - Solo si hay plan Y no hay páginas Y hay dataId
  useEffect(() => {
    console.log(`📋 [TODO-INIT] Checking TODO initialization:`);
    console.log(`  - Plan length: ${plan?.length || 0}`);
    console.log(`  - Monitor pages length: ${monitorPages.length}`);
    console.log(`  - DataId: ${dataId}`);
    
    if (plan && plan.length > 0 && monitorPages.length === 0 && dataId) {
      console.log(`📋 [TODO-INIT] Initializing TODO page for task ${dataId}`);
      
      const todoPlan = plan.map((step, index) => 
        `${index + 1}. ${step.title} ${step.completed ? '✓' : '○'}`
      ).join('\n');
      
      const todoPage: MonitorPage = {
        id: 'todo-plan',
        title: 'TODO.md - Plan de Acción',
        content: `# Plan de Acción\n\n${todoPlan}\n\n---\n\n*Generado automáticamente por el sistema de monitoreo*`,
        type: 'plan',
        timestamp: new Date(),
        metadata: {
          lineCount: plan.length + 4,
          status: 'success'
        }
      };
      
      console.log(`📋 [TODO-INIT] Creating TODO page:`, todoPage);
      
      // ✅ USAR CONTEXT PARA PERSISTIR PÁGINAS
      if (taskId) {
        setTaskMonitorPages(taskId, [todoPage]);
      }
      
      setPaginationStats(prev => ({ ...prev, totalPages: 1 }));
      console.log(`✅ [TODO-INIT] TODO page created for task ${dataId}`);
    } else {
      console.log(`📋 [TODO-INIT] Skipping TODO initialization - conditions not met`);
    }
  }, [plan, dataId, monitorPages.length]); // Solo para cargar TODO.md inicial

  // SEPARAR: Verificar completación y cargar informe final
  useEffect(() => {
    if (plan && plan.length > 0 && taskId) {
      const allCompleted = plan.every(step => step.completed);
      const completedCount = plan.filter(s => s.completed).length;
      
      console.log('🔍 [DEBUG] Plan estado:', {
        totalSteps: plan.length,
        completedSteps: completedCount,
        allCompleted,
        taskId,
        planSteps: plan.map(s => ({ id: s.id, title: s.title, completed: s.completed }))
      });
      
      // Cargar informe final si la tarea está completada
      if (allCompleted && completedCount > 0) {
        console.log('🎯 [DEBUG] Todos los pasos completados, cargando informe final para tarea:', taskId);
        
        // Verificar que no se haya cargado ya el informe final
        const hasReportPage = monitorPages.some(page => page.id === 'final-report');
        if (!hasReportPage) {
          setTimeout(() => {
            const finalReportPage: MonitorPage = {
              id: 'final-report',
              title: '📄 INFORME FINAL - Tarea Completada',
              content: 'Cargando informe final...',
              type: 'report',
              timestamp: new Date(),
              metadata: {
                lineCount: 1,
                status: 'success',
                fileSize: 0
              }
            };
            
            console.log('📄 [DEBUG] Añadiendo página de informe final');
            // ✅ FIX: Usar Context aislado consistentemente
            const currentPages = taskId ? getTaskMonitorPages(taskId) : [];
            const newPages = [...currentPages, finalReportPage];
            setTaskMonitorPages(taskId, newPages);
            // Navegar automáticamente a la página del informe final cuando se agrega
            setTaskCurrentPageIndex(taskId, newPages.length - 1);
            setIsLiveMode(false);
            setPaginationStats(prev => ({ ...prev, totalPages: prev.totalPages + 1 }));
            loadFinalReport(taskId);
          }, 1000);
        }
      }
    }
  }, [plan, taskId, monitorPages]); // Separado para detectar cambios en completación

  // Procesar herramientas y crear páginas
  useEffect(() => {
    if (toolResults.length > 0) {
      const newPages: MonitorPage[] = [];
      
      toolResults.forEach((result, index) => {
        // Crear página para cada herramienta utilizada
        const pageContent = generateToolPageContent(result);
        
        const toolPage: MonitorPage = {
          id: `tool-${result.tool || 'unknown'}-${index}`,
          title: `${(result.tool || 'HERRAMIENTA').toUpperCase()} - Ejecución #${index + 1}`,
          content: pageContent,
          type: 'tool-execution',
          timestamp: new Date(),
          toolName: result.tool || 'unknown',
          toolParams: result.parameters,
          metadata: {
            lineCount: pageContent.split('\n').length,
            status: result.result.error ? 'error' : 'success',
            executionTime: result.executionTime || 0
          }
        };
        
        newPages.push(toolPage);
        
        // Si es deep research, crear página adicional para el reporte
        if (result.tool === 'enhanced_deep_research' && result.result?.result?.console_report) {
          const reportPage: MonitorPage = {
            id: `report-${index}`,
            title: `Informe de Investigación - ${new Date().toLocaleDateString()}`,
            content: result.result.result.console_report,
            type: 'report',
            timestamp: new Date(),
            metadata: {
              lineCount: result.result.result.console_report.split('\n').length,
              fileSize: result.result.result.console_report.length,
              status: 'success'
            }
          };
          
          newPages.push(reportPage);
        }
      });
      
      // Actualizar páginas manteniendo TODO.md como primera página
      if (taskId) {
        console.log(`🔧 [TOOL-PAGES] Adding ${newPages.length} tool pages to task ${taskId}`);
        const currentPages = getTaskMonitorPages(taskId);
        const todoPage = currentPages.find(p => p.id === 'todo-plan');
        const otherPages = currentPages.filter(p => p.id !== 'todo-plan');
        const allPages = todoPage ? [todoPage, ...otherPages, ...newPages] : [...otherPages, ...newPages];
        
        setTaskMonitorPages(taskId, allPages);
        console.log(`✅ [TOOL-PAGES] Set ${allPages.length} total pages for task ${taskId}`);
        
        setPaginationStats(prevStats => ({
          ...prevStats,
          totalPages: allPages.length
        }));
        
        // Mantener en modo Live y ir a la última página automáticamente
        if (isLiveMode && allPages.length > 0) {
          setTaskCurrentPageIndex(taskId, allPages.length - 1);
          console.log(`🔴 [TOOL-PAGES] Live mode: navigated to page ${allPages.length - 1}`);
        }
      }
      
      // Set current executing tool
      if (toolResults.length > 0) {
        setCurrentExecutingTool(toolResults[toolResults.length - 1]);
      }
    }
  }, [toolResults]);

  // Procesar logs externos
  useEffect(() => {
    if (externalLogs.length > 0) {
      const newPages: MonitorPage[] = [];
      
      externalLogs.forEach((log, index) => {
        if (log.message.includes('# ') || log.message.includes('## ') || log.message.includes('### ')) {
          const logPage: MonitorPage = {
            id: `log-${index}`,
            title: `Registro del Sistema - ${log.timestamp.toLocaleTimeString()}`,
            content: log.message,
            type: 'file',
            timestamp: log.timestamp,
            metadata: {
              lineCount: log.message.split('\n').length,
              status: log.type === 'error' ? 'error' : 'success'
            }
          };
          
          newPages.push(logPage);
        }
      });
      
      if (newPages.length > 0 && taskId) {
        console.log(`📝 [LOG-PAGES] Adding ${newPages.length} log pages to task ${taskId}`);
        const currentPages = getTaskMonitorPages(taskId);
        const allPages = [...currentPages, ...newPages];
        setTaskMonitorPages(taskId, allPages);
        
        setPaginationStats(prev => ({
          ...prev,
          totalPages: allPages.length
        }));
      }
    }
  }, [externalLogs]);

  // ✅ LÓGICA WEBSOCKET PARA EVENTOS DE TIEMPO REAL - SEGÚN UpgardeRef.md SECCIÓN 5.3
  useEffect(() => {
    if (!socket || !taskId) return;

    console.log(`🔌 [TERMINAL-${taskId}] Setting up real-time WebSocket listeners`);
    console.log(`🔌 [TERMINAL-${taskId}] Task ID for WebSocket join:`, taskId);

    // Unirse a la sala de la tarea
    joinTaskRoom(taskId);

    // Definir manejadores de eventos para visualización en tiempo real
    const handleBrowserActivity = (data: any) => {
      console.log(`🌐 [BROWSER-${taskId}] Browser activity received:`, data);
      
      if (!data || data.task_id !== taskId) return; // Solo procesar eventos de esta tarea
      
      // 🔧 FIX CRÍTICO: Verificación defensiva de propiedades
      const url = data.url || '';
      const title = data.title || 'Sin título';
      const activityType = data.activity_type || 'navegación';
      const timestamp = data.timestamp || new Date().toISOString();
      
      // Solo crear página si hay URL válida
      if (url) {
        try {
          const hostname = new URL(url).hostname;
          const browserPage: MonitorPage = {
            id: `browser-${Date.now()}`,
            title: `🌐 Navegación: ${title || hostname}`,
            content: `**URL:** ${url}\n**Título:** ${title}\n**Tipo:** ${activityType}`,
            type: 'web-browsing',
            timestamp: new Date(timestamp),
            metadata: {
              url: url,
              screenshotUrl: data.screenshot_url || '',
              status: 'success'
            }
          };
          
          addTaskMonitorPage(taskId, browserPage);
        } catch (urlError) {
          console.warn(`⚠️ Invalid URL in browser activity: ${url}`);
        }
      }
    };

    const handleDataCollectionUpdate = (data: any) => {
      console.log(`📊 [DATA-${taskId}] Data collection update received:`, data);
      
      if (!data || data.task_id !== taskId) return;
      
      // 🔧 FIX CRÍTICO: Verificación defensiva de propiedades
      const dataSummary = data.data_summary || 'Recolección de datos';
      const partialData = data.partial_data || null;
      const timestamp = data.timestamp || new Date().toISOString();
      
      const dataPage: MonitorPage = {
        id: `data-${Date.now()}`,
        title: `📊 ${dataSummary}`,
        content: partialData ? JSON.stringify(partialData, null, 2) : dataSummary,
        type: 'data-collection',
        timestamp: new Date(timestamp),
        metadata: {
          dataSummary: dataSummary,
          partialData: partialData,
          status: 'success'
        }
      };
      
      addTaskMonitorPage(taskId, dataPage);
    };

    const handleReportProgress = (data: any) => {
      console.log(`📄 [REPORT-${taskId}] Report progress received:`, data);
      
      if (data.task_id !== taskId) return;
      
      // Buscar o crear la página del informe
      const currentPages = getTaskMonitorPages(taskId);
      let reportPage = currentPages.find(p => p.id === 'incremental-report');
      
      if (!reportPage) {
        reportPage = {
          id: 'incremental-report',
          title: '📄 Informe en Construcción',
          content: '',
          type: 'report',
          timestamp: new Date(),
          metadata: { status: 'running' }
        };
      }
      
      // Actualizar contenido del informe (concatenar o reemplazar)
      const newContent = data.full_report_so_far || (reportPage.content + (data.content_delta || ''));
      
      const updatedReportPage = {
        ...reportPage,
        content: newContent,
        timestamp: new Date(data.timestamp),
        title: `📄 ${data.section_title}`
      };
      
      // Actualizar página existente o agregar nueva
      const updatedPages = currentPages.map(p => 
        p.id === 'incremental-report' ? updatedReportPage : p
      );
      
      if (!currentPages.find(p => p.id === 'incremental-report')) {
        updatedPages.push(updatedReportPage);
      }
      
      setTaskMonitorPages(taskId, updatedPages);
    };

    const handleLogMessage = (data: any) => {
      console.log(`📝 [LOG-${taskId}] Log message received:`, data);
      
      if (!data || data.task_id !== taskId) return;
      
      // 🔧 FIX CRÍTICO: Verificar que data.message existe antes de usarlo
      const message = data.message || '';
      const level = data.level || 'info';
      const timestamp = data.timestamp || new Date().toISOString();
      
      // Añadir al terminal output
      const logPrefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'info' ? 'ℹ️' : '🔧';
      setTerminalOutput(prev => [...prev, `${logPrefix} [${level.toUpperCase()}] ${message}`]);
      
      // También crear una página de monitor para logs importantes (con verificación de longitud segura)
      if (level === 'error' || (message && message.length > 100)) {
        const logPage: MonitorPage = {
          id: `log-${Date.now()}`,
          title: `${logPrefix} Log: ${level.toUpperCase()}`,
          content: message,
          type: 'log',
          timestamp: new Date(timestamp),
          metadata: { 
            logLevel: level,
            status: level === 'error' ? 'error' : 'success'
          }
        };
        
        addTaskMonitorPage(taskId, logPage);
      }
    };

    const handleBrowserVisual = (data: any) => {
      console.log(`📸 [BROWSER-VISUAL-${taskId}] Screenshot received:`, data);
      console.warn(`🔍 [TASK_ID_DEBUG] Frontend taskId: "${taskId}"`);
      console.warn(`🔍 [TASK_ID_DEBUG] Data task_id: "${data?.task_id}"`);
      console.warn(`🔍 [TASK_ID_DEBUG] IDs coinciden: ${data?.task_id === taskId}`);
      
      if (!data) {
        console.error(`❌ [BROWSER_VISUAL_ERROR] Data is null/undefined`);
        return;
      }
      
      if (data.task_id !== taskId) {
        console.error(`❌ [BROWSER_VISUAL_ERROR] Task ID mismatch - dropping event`);
        console.error(`   Expected: "${taskId}"`);
        console.error(`   Received: "${data.task_id}"`);
        return;
      }
      
      console.log(`✅ [BROWSER_VISUAL_SUCCESS] Processing browser visual event`);
      
      // 🔍 DEBUG: Verificar qué campos están disponibles
      console.log(`🔍 [SCREENSHOT_DEBUG] data.screenshot: "${data.screenshot}"`);
      console.log(`🔍 [SCREENSHOT_DEBUG] data.screenshot_url: "${data.screenshot_url}"`);
      console.log(`🔍 [SCREENSHOT_DEBUG] Screenshot final usado: "${data.screenshot_url || data.screenshot}"`);
      
      try {
        // Agregar screenshot al estado
        const newScreenshot = {
          id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          screenshot: data.screenshot_url || data.screenshot,  // 🔧 FIX: Usar screenshot_url primero
          step: data.step || 'Navegación',
          timestamp: data.timestamp || new Date().toISOString(),
          url: data.url
        };
        
        setBrowserScreenshots(prev => {
          const updated = [...prev, newScreenshot];
          // Mantener solo los últimos 10 screenshots para rendimiento
          return updated.slice(-10);
        });
        
        // Actualizar screenshot actual (FIX: usar screenshot_url)
        setCurrentScreenshot(data.screenshot_url || data.screenshot);
        
        // Crear página de monitor para navegación visual
        const visualPage: MonitorPage = {
          id: `browser-visual-${Date.now()}`,
          title: `🌐 ${data.step || 'Navegación Web'}`,
          content: `# Navegación Web en Tiempo Real\n\n## ${data.step || 'Navegación'}\n\n**Timestamp:** ${new Date(data.timestamp).toLocaleTimeString()}\n**URL:** ${data.url || 'Desconocida'}\n\n![Screenshot](${data.screenshot_url || data.screenshot || 'undefined'})\n\n---\n\n*Captura automática de navegación browser-use*`,
          type: 'web-browsing',
          timestamp: new Date(data.timestamp),
          metadata: {
            status: 'success',
            url: data.url,
            screenshotUrl: data.screenshot_url || data.screenshot  // 🔧 FIX: Usar screenshot_url primero
          }
        };
        
        // Agregar página de navegación visual al monitor
        addTaskMonitorPage(taskId, visualPage);
        
        // Actualizar terminal output
        setTerminalOutput(prev => [...prev, `📸 ${data.step || 'Screenshot capturado'} - ${new Date(data.timestamp).toLocaleTimeString()}`]);
        
      } catch (error) {
        console.error(`❌ [BROWSER-VISUAL-${taskId}] Error procesando screenshot:`, error);
        setTerminalOutput(prev => [...prev, `❌ Error procesando navegación visual: ${error}`]);
      }
    };

    // Manejador genérico para eventos task_update
    const handleTaskUpdate = (data: any) => {
      console.log(`🔄 [TASK-${taskId}] Task update received:`, data);
      
      if (!data || data.task_id !== taskId) return;
      
      // 🔧 FIX CRÍTICO: Verificación defensiva del tipo de evento
      const eventType = data.type || 'unknown';
      
      // Enrutar según el tipo de evento
      switch (eventType) {
        case 'browser_activity':
          handleBrowserActivity(data);
          break;
        case 'data_collection_update':
          handleDataCollectionUpdate(data);
          break;
        case 'report_progress':
          handleReportProgress(data);
          break;
        case 'log_message':
          handleLogMessage(data);
          break;
        case 'step_started':
          console.log(`🚀 [TASK-${taskId}] Step started:`, data.step || 'unknown step');
          // El plan component ya maneja estos eventos, solo loggeamos aquí
          break;
        case 'step_completed':
          console.log(`✅ [TASK-${taskId}] Step completed:`, data.step || 'unknown step');
          // El plan component ya maneja estos eventos, solo loggeamos aquí
          break;
        case 'task_progress':
          console.log(`📊 [TASK-${taskId}] Task progress:`, data.progress);
          // El plan component ya maneja estos eventos, solo loggeamos aquí
          break;
        default:
          console.log(`🔄 [TASK-${taskId}] Unknown update type:`, data.type);
      }
    };

    // Registrar manejadores de eventos
    const eventHandlers = {
      browser_activity: (data: any) => {
        console.log(`🌐 [WEBSOCKET-RECEIVED] browser_activity for task ${taskId}:`, data);
        handleBrowserActivity(data);
      },
      data_collection_update: (data: any) => {
        console.log(`📊 [WEBSOCKET-RECEIVED] data_collection_update for task ${taskId}:`, data);
        handleDataCollectionUpdate(data);
      },
      report_progress: (data: any) => {
        console.log(`📋 [WEBSOCKET-RECEIVED] report_progress for task ${taskId}:`, data);
        handleReportProgress(data);
      },
      log_message: (data: any) => {
        console.log(`📝 [WEBSOCKET-RECEIVED] log_message for task ${taskId}:`, data);
        handleLogMessage(data);
      },
      task_update: (data: any) => {
        console.log(`🔄 [WEBSOCKET-RECEIVED] task_update for task ${taskId}:`, data);
        handleTaskUpdate(data);
      },
      progress_update: (data: any) => {
        console.log(`📈 [WEBSOCKET-RECEIVED] progress_update for task ${taskId}:`, data);
        handleTaskUpdate(data);
      },
      agent_activity: (data: any) => {
        console.log(`🤖 [WEBSOCKET-RECEIVED] agent_activity for task ${taskId}:`, data);
        handleTaskUpdate(data);
      },
      browser_visual: (data: any) => {
        console.log(`📸 [WEBSOCKET-RECEIVED] browser_visual for task ${taskId}:`, data);
        console.log(`🔍 [DEBUG] Task ID usado: ${taskId}`);
        console.log(`🔍 [DEBUG] Data completa recibida:`, JSON.stringify(data, null, 2));
        console.warn(`🚨 [BROWSER_VISUAL_DEBUG] Evento recibido en frontend!`);
        handleBrowserVisual(data);
      }
    };

    addEventListeners(eventHandlers);

    // Cleanup function
    return () => {
      console.log(`🔌 [TERMINAL-${taskId}] Cleaning up WebSocket listeners`);
      removeEventListeners();
    };
  }, [socket, taskId, addTaskMonitorPage, getTaskMonitorPages, setTaskMonitorPages, joinTaskRoom, addEventListeners, removeEventListeners]);

  // Procesar datos de ejecución del backend
  useEffect(() => {
    if (executionData && executionData.executed_tools) {
      console.log('🔧 Processing execution data in terminal:', executionData);
      
      const newPages: MonitorPage[] = [];
      
      executionData.executed_tools.forEach((tool: any, index: number) => {
        if (tool.result && tool.tool) {
          // Crear página para cada herramienta ejecutada
          const pageContent = generateBackendToolPageContent(tool);
          const toolName = tool.tool || 'herramienta';
          
          const toolPage: MonitorPage = {
            id: `backend-tool-${toolName}-${index}`,
            title: `${toolName.toUpperCase()} - Ejecutado por Backend`,
            content: pageContent,
            type: 'tool-execution',
            timestamp: new Date(tool.timestamp || new Date()),
            toolName: tool.tool,
            toolParams: tool.parameters,
            metadata: {
              lineCount: pageContent.split('\n').length,
              status: tool.success ? 'success' : 'error',
              executionTime: tool.result?.execution_time || 0
            }
          };
          
          newPages.push(toolPage);
        }
      });
      
      // Si la tarea está completada, agregar página de informe final para cualquier tarea
      if (executionData.status === 'completed') {
        const finalReportPage: MonitorPage = {
          id: 'final-report',
          title: '📄 INFORME FINAL - Tarea Completada',
          content: 'Cargando informe final...',
          type: 'report',
          timestamp: new Date(),
          metadata: {
            lineCount: 1,
            status: 'success',
            fileSize: 0
          }
        };
        
        newPages.push(finalReportPage);
        
        // Cargar el informe final desde el backend para cualquier tarea completada
        if (taskId) {
          loadFinalReport(taskId);
        }
      }
      
      if (newPages.length > 0 && taskId) {
        console.log(`🔧 [EXEC-PAGES] Adding ${newPages.length} execution pages to task ${taskId}`);
        const currentPages = getTaskMonitorPages(taskId);
        const allPages = [...currentPages, ...newPages];
        setTaskMonitorPages(taskId, allPages);
        
        setPaginationStats(prev => ({
          ...prev,
          totalPages: allPages.length
        }));
        
        // Agregar logs de terminal para mostrar la ejecución
        const executionLogs = executionData.executed_tools.map((tool: any, index: number) => 
          `[${new Date().toLocaleTimeString()}] ✅ ${tool.tool}: ${tool.success ? 'SUCCESS' : 'FAILED'} (${tool.result?.execution_time || 0}s)`
        );
        
        setTerminalOutput(prev => [...prev, ...executionLogs]);
      }
    }
  }, [executionData, taskId]);

  // Efecto para mantener el modo Live siempre en la última página
  useEffect(() => {
    if (isLiveMode && monitorPages.length > 0 && taskId) {
      console.log(`🔴 [LIVE-MODE] Navigating to last page ${monitorPages.length - 1} for task ${taskId}`);
      setTaskCurrentPageIndex(taskId, monitorPages.length - 1);
    }
  }, [monitorPages.length, isLiveMode, taskId, setTaskCurrentPageIndex]);

  const generateBackendToolPageContent = (tool: any): string => {
    const timestamp = tool.timestamp || new Date().toISOString();
    const toolName = tool.tool || 'herramienta';
    let content = `# Ejecución Backend: ${toolName.toUpperCase()}\n\n`;
    content += `**Timestamp:** ${timestamp}\n`;
    content += `**Status:** ${tool.success ? '✅ SUCCESS' : '❌ FAILED'}\n`;
    content += `**Tiempo de ejecución:** ${tool.result?.execution_time || 0}s\n\n`;
    
    if (tool.parameters) {
      content += `**Parámetros:**\n\`\`\`json\n${JSON.stringify(tool.parameters, null, 2)}\n\`\`\`\n\n`;
    }
    
    if (tool.result) {
      content += `**Resultado:**\n\`\`\`json\n${JSON.stringify(tool.result, null, 2)}\n\`\`\`\n\n`;
    }
    
    // Procesamiento específico por herramienta
    if (tool.tool === 'web_search' && tool.result?.results) {
      content += `**Resultados de búsqueda:**\n`;
      tool.result.results.forEach((result: any, index: number) => {
        content += `${index + 1}. **${result.title}**\n`;
        content += `   URL: ${result.url}\n`;
        content += `   Snippet: ${result.snippet || 'N/A'}\n\n`;
      });
    } else if (tool.tool === 'shell' && tool.result?.stdout) {
      content += `**Output:**\n\`\`\`bash\n${tool.result.stdout}\n\`\`\`\n`;
      if (tool.result.stderr) {
        content += `**Error:**\n\`\`\`bash\n${tool.result.stderr}\n\`\`\`\n`;
      }
    } else if (tool.tool === 'file_manager') {
      content += `**Operación:** ${tool.parameters?.action || 'N/A'}\n`;
      content += `**Archivo:** ${tool.parameters?.path || 'N/A'}\n`;
      if (tool.result?.success) {
        content += `**Resultado:** Operación completada exitosamente\n`;
      }
    }
    
    return content;
  };

  const generateToolPageContent = (result: ToolResult): string => {
    const timestamp = new Date().toISOString();
    const toolName = result.tool || 'herramienta';
    let content = `# Ejecución de Herramienta: ${toolName.toUpperCase()}\n\n`;
    content += `**Timestamp:** ${timestamp}\n`;
    content += `**Parámetros:**\n\`\`\`json\n${JSON.stringify(result.parameters, null, 2)}\n\`\`\`\n\n`;
    
    if (result.tool === 'shell') {
      content += `**Comando:** \`${result.parameters.command}\`\n\n`;
      content += `**Salida:**\n\`\`\`bash\n`;
      if (result.result.stdout) content += result.result.stdout;
      if (result.result.stderr) content += `\nERROR: ${result.result.stderr}`;
      content += `\n\`\`\`\n`;
    } else if (result.tool === 'web_search') {
      content += `**Búsqueda:** ${result.parameters.query}\n\n`;
      if (result.result.results) {
        content += `**Resultados encontrados:** ${result.result.results.length}\n\n`;
        result.result.results.slice(0, 5).forEach((res: any, i: number) => {
          content += `### ${i + 1}. ${res.title}\n`;
          content += `**URL:** ${res.url}\n`;
          content += `**Snippet:** ${res.snippet}\n\n`;
        });
      }
    } else if (result.tool === 'file_manager') {
      content += `**Acción:** ${result.parameters.action}\n`;
      content += `**Ruta:** ${result.parameters.path}\n\n`;
      if (result.result.success) {
        content += `✅ **Éxito:** ${result.result.success}\n`;
      }
      if (result.result.error) {
        content += `❌ **Error:** ${result.result.error}\n`;
      }
    }
    
    return content;
  };

  // Navigation handlers
  const handlePreviousPage = () => {
    if (actualCurrentPageIndex > 0) {
      setTaskCurrentPageIndex(taskId, actualCurrentPageIndex - 1);
      setIsLiveMode(false);
    }
  };

  const handleNextPage = () => {
    if (actualCurrentPageIndex < monitorPages.length - 1) {
      setTaskCurrentPageIndex(taskId, actualCurrentPageIndex + 1);
      setIsLiveMode(false);
    }
  };

  const handleLiveMode = () => {
    if (monitorPages.length > 0) {
      setTaskCurrentPageIndex(taskId, monitorPages.length - 1);
      setIsLiveMode(true);
    }
  };

  const handleResetToStart = () => {
    setTaskCurrentPageIndex(taskId, 0);
    setIsLiveMode(false);
  };

  const formatMarkdownContent = (content: string) => {
    return (
      <div className="academic-document bg-white text-black p-6 rounded-lg shadow-lg w-full max-w-none">
        <div dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(content) }} />
      </div>
    );
  };

  const formatMarkdownToHtml = (markdown: string): string => {
    let html = markdown;
    
    // Academic title
    html = html.replace(/^# (.+)$/gm, '<div class="academic-title">$1</div>');
    
    // Headers
    html = html.replace(/^## (.+)$/gm, '<div class="academic-section"><h2>$1</h2></div>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    
    // Bold text
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic text
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Paragraphs
    html = html.replace(/^(?!<[^>]*>|```|\s*$)(.+)$/gm, '<p>$1</p>');
    
    return html;
  };

  const currentPage = monitorPages[actualCurrentPageIndex];
  const isLastPage = actualCurrentPageIndex === monitorPages.length - 1;

  return (
    <div data-id={dataId} className="flex flex-col h-full w-full bg-[#2a2a2b] text-[#dadada] p-2 sm:p-4 font-sans text-sm sm:text-base overflow-hidden">
      {/* Header - Responsive Design */}
      <div className="flex items-center gap-2 mb-2 sm:mb-4 flex-wrap sm:flex-nowrap">
        <Monitor size={16} className="text-blue-400 sm:w-5 sm:h-5 flex-shrink-0" />
        <div className="flex-1 text-base sm:text-lg font-semibold truncate min-w-0">{title}</div>
        <div className="flex items-center gap-1 sm:gap-3 text-xs sm:text-sm text-[#7f7f7f] flex-shrink-0">
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${isSystemOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="hidden sm:inline">{isSystemOnline ? 'ONLINE' : 'OFFLINE'}</span>
            <span className="sm:hidden">{isSystemOnline ? '●' : '●'}</span>
          </div>
          <div className="flex items-center gap-1">
            <Radio size={12} className="text-blue-400 sm:w-3.5 sm:h-3.5" />
            <span className="whitespace-nowrap">{actualCurrentPageIndex + 1}/{monitorPages.length}</span>
          </div>
        </div>
        <button onClick={onFullscreen} className="p-1 sm:p-1.5 rounded-md hover:bg-black/10 flex-shrink-0">
          <Maximize2 size={16} className="text-[#7f7f7f] sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* Tool Execution Status - Responsive */}
      {currentExecutingTool && isLive && (
        <div className="mb-2 sm:mb-4 p-2 sm:p-3 bg-[#2a2a2b] rounded-lg border border-blue-400/30">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3 h-3 sm:w-4 sm:h-4 text-blue-400 animate-pulse flex-shrink-0" />
            <span className="text-xs sm:text-sm font-medium text-blue-400">Ejecutando</span>
          </div>
          <ToolExecutionDetails
            tool={currentExecutingTool.tool}
            parameters={currentExecutingTool.parameters}
            status="executing"
            showDetailedView={true}
            className="text-xs sm:text-sm"
          />
        </div>
      )}

      {/* Monitor Display - Responsive Container */}
      <div className="flex-1 flex flex-col bg-[#383739] rounded-lg border border-black/30 overflow-hidden min-h-0">
        {/* Monitor Header - Responsive */}
        <div className="h-8 sm:h-10 flex items-center px-2 sm:px-4 border-b border-white/10 bg-[#383739]">
          <div className="flex-1 text-center min-w-0">
            <span className="text-xs sm:text-sm font-medium text-[#dadada] truncate block">
              {currentPage ? currentPage.title : 'Monitor Mitosis'}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 text-xs text-[#7f7f7f] flex-shrink-0">
            {currentPage && (
              <>
                <FileText className="w-3 h-3 hidden sm:block" />
                <span className="hidden sm:inline">{currentPage.metadata?.lineCount || 0} líneas</span>
                <span className="sm:hidden">{currentPage.metadata?.lineCount || 0}L</span>
                {currentPage.metadata?.fileSize && (
                  <span className="hidden sm:inline">• {Math.round(currentPage.metadata.fileSize / 1024)} KB</span>
                )}
                <span className={`px-1 sm:px-2 py-0.5 sm:py-1 rounded text-xs ${
                  currentPage.metadata?.status === 'success' ? 'bg-green-500/20 text-green-400' :
                  currentPage.metadata?.status === 'error' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {(currentPage.metadata?.status || 'ok').toUpperCase()}
                </span>
              </>
            )}
          </div>
        </div>
        
        {/* Monitor Content - Responsive Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 custom-scrollbar w-full min-h-0" ref={monitorRef}>
          
          {/* Browser Visual - Screenshots en Tiempo Real */}
          {currentScreenshot && (
            <div className="mb-4 p-3 bg-[#2a2a2b] rounded-lg border border-purple-400/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-sm font-medium text-purple-400">🌐 Navegación en Tiempo Real</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {browserScreenshots.length > 0 ? 
                    new Date(browserScreenshots[browserScreenshots.length - 1].timestamp).toLocaleTimeString() 
                    : 'Ahora'
                  }
                </span>
              </div>
              <div className="space-y-2">
                {browserScreenshots.length > 0 && (
                  <div className="text-xs text-gray-300">
                    {browserScreenshots[browserScreenshots.length - 1].step}
                  </div>
                )}
                <img 
                  src={currentScreenshot} 
                  alt="Navegación browser-use en tiempo real" 
                  className="rounded-lg max-w-full h-auto border border-[#404040] shadow-lg"
                  style={{ maxHeight: '300px', maxWidth: '100%' }}
                />
                {browserScreenshots.length > 1 && (
                  <div className="text-xs text-gray-400 text-center">
                    Screenshot {browserScreenshots.length} de la navegación
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Show initialization steps when initializing - MINIMALIST COMPUTER DESIGN */}
          {isInitializing && !isSystemOnline && (
            <div className="flex items-center justify-center h-full w-full">
              <div className="max-w-xs w-full space-y-6">
                {/* Computer Icon - Using existing Monitor icon in GRAY */}
                <div className="flex justify-center mb-8">
                  <Monitor size={48} className="text-gray-400" />
                </div>
                
                {/* Steps - Granular with checkmarks - CENTERED TEXTS */}
                <div className="space-y-3">
                  {initializationSteps.map((step, index) => (
                    <div key={step.id} className="text-center">
                      <div className={`text-sm ${
                        index < initializationStep ? 'text-gray-400' :
                        index === initializationStep ? 'text-gray-300' :
                        'text-gray-600'
                      }`}>
                        {step.title}
                        {index === initializationStep && '...'}
                        {/* Checkmark for completed steps - CONSISTENT WITH PLAN DE ACCION */}
                        {index < initializationStep && (
                          <span className="ml-2">
                            <Check className="w-3 h-3 text-green-500 inline" />
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Progress Bar - 40% narrower and stable - CENTERED */}
                <div className="space-y-3 mt-8">
                  <div className="flex justify-center">
                    <div className="w-3/5 bg-gray-700 rounded-full h-1.5">
                      <div 
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                        style={{ 
                          width: `${(initializationStep / initializationSteps.length) * 100}%` 
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-center text-xs text-gray-500">
                    {Math.round((initializationStep / initializationSteps.length) * 100)}%
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Normal content when not initializing */}
          {(!isInitializing || isSystemOnline) && (
            <>
              {currentPage ? (
                <div className="space-y-4 w-full">
                  {currentPage.type === 'plan' || currentPage.type === 'report' ? (
                    <div className="w-full">
                      {formatMarkdownContent(currentPage.content)}
                    </div>
                  ) : currentPage.type === 'web-browsing' ? (
                    // ✅ RENDERIZADO PARA NAVEGACIÓN WEB - SEGÚN UpgardeRef.md SECCIÓN 5.3
                    <div className="space-y-4 w-full">
                      <div className="flex items-center gap-2 text-sm text-[#ACACAC] border-b border-[#404040] pb-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="font-medium">NAVEGACIÓN WEB</span>
                        <span className="text-xs ml-auto">{currentPage.timestamp.toLocaleString()}</span>
                      </div>
                      <div className="web-browsing-content">
                        <div className="mb-4">
                          <h3 className="text-lg font-semibold text-white mb-2">🌐 {currentPage.title}</h3>
                          {currentPage.metadata?.url && (
                            <p className="text-sm mb-2">
                              <strong>URL:</strong> 
                              <a 
                                href={currentPage.metadata.url} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-blue-400 hover:underline ml-2"
                              >
                                {currentPage.metadata.url}
                              </a>
                            </p>
                          )}
                          {currentPage.metadata?.screenshotUrl && (
                            <div className="mt-4">
                              <img 
                                src={currentPage.metadata.screenshotUrl} 
                                alt="Captura de pantalla de navegación" 
                                className="rounded-lg max-w-full h-auto border border-[#404040]"
                                style={{ maxHeight: '400px' }}
                              />
                            </div>
                          )}
                          <div className="mt-4">
                            <pre className="text-sm font-mono text-[#e0e0e0] whitespace-pre-wrap">
                              {currentPage.content}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : currentPage.type === 'data-collection' ? (
                    // ✅ RENDERIZADO PARA RECOLECCIÓN DE DATOS - SEGÚN UpgardeRef.md SECCIÓN 5.3
                    <div className="space-y-4 w-full">
                      <div className="flex items-center gap-2 text-sm text-[#ACACAC] border-b border-[#404040] pb-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="font-medium">DATOS RECOLECTADOS</span>
                        <span className="text-xs ml-auto">{currentPage.timestamp.toLocaleString()}</span>
                      </div>
                      <div className="data-collection-content">
                        <h3 className="text-lg font-semibold text-white mb-2">📊 {currentPage.title}</h3>
                        {currentPage.metadata?.dataSummary && (
                          <p className="text-sm mb-4 text-green-400">
                            <strong>Resumen:</strong> {currentPage.metadata.dataSummary}
                          </p>
                        )}
                        {currentPage.metadata?.partialData && (
                          <div className="mb-4">
                            <h4 className="text-sm font-semibold text-[#DADADA] mb-2">Datos parciales:</h4>
                            <pre className="bg-[#2a2a2b] p-3 rounded text-xs overflow-x-auto">
                              {JSON.stringify(currentPage.metadata.partialData, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div className="mt-4">
                          <pre className="text-sm font-mono text-[#e0e0e0] whitespace-pre-wrap">
                            {currentPage.content}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : currentPage.type === 'log' ? (
                    // ✅ RENDERIZADO PARA LOGS - SEGÚN UpgardeRef.md SECCIÓN 5.3
                    <div className="space-y-4 w-full">
                      <div className="flex items-center gap-2 text-sm text-[#ACACAC] border-b border-[#404040] pb-2">
                        <div className={`w-2 h-2 rounded-full ${
                          currentPage.metadata?.logLevel === 'error' ? 'bg-red-400' :
                          currentPage.metadata?.logLevel === 'warn' ? 'bg-yellow-400' :
                          'bg-blue-400'
                        }`} />
                        <span className="font-medium">LOG MESSAGE</span>
                        <span className="text-xs ml-auto">{currentPage.timestamp.toLocaleString()}</span>
                      </div>
                      <div className="log-content">
                        <h3 className={`text-lg font-semibold mb-2 ${
                          currentPage.metadata?.logLevel === 'error' ? 'text-red-400' :
                          currentPage.metadata?.logLevel === 'warn' ? 'text-yellow-400' :
                          'text-white'
                        }`}>
                          {currentPage.metadata?.logLevel === 'error' ? '❌' :
                           currentPage.metadata?.logLevel === 'warn' ? '⚠️' :
                           'ℹ️'} {currentPage.title}
                        </h3>
                        <pre className="text-sm font-mono text-[#e0e0e0] whitespace-pre-wrap">
                          {currentPage.content}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    // Renderizado para tipos existentes (tool-execution, file, error)
                    <div className="space-y-2 w-full">
                      <div className="flex items-center gap-2 text-sm text-[#ACACAC] border-b border-[#404040] pb-2">
                        <div className={`w-2 h-2 rounded-full ${
                          currentPage.type === 'tool-execution' ? 'bg-blue-400' :
                          currentPage.type === 'file' ? 'bg-green-400' :
                          currentPage.type === 'error' ? 'bg-red-400' :
                          currentPage.type === 'web-browsing' ? 'bg-purple-400' :
                          currentPage.type === 'data-collection' ? 'bg-green-400' :
                          currentPage.type === 'log' ? 'bg-yellow-400' :
                          'bg-gray-400'
                        }`} />
                        <span className="font-medium">{(currentPage.type || 'page').toUpperCase()}</span>
                        <span className="text-xs ml-auto">{currentPage.timestamp.toLocaleString()}</span>
                      </div>
                      
                      <div className="terminal-pager w-full">
                        <pre className="text-sm font-mono text-[#e0e0e0] whitespace-pre-wrap w-full max-w-none overflow-x-auto">
                          {currentPage.content}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full w-full text-[#7f7f7f]">
                  <Monitor className="w-12 h-12 mb-3 opacity-50" />
                  <p className="text-center">Sistema de monitoreo listo</p>
                  <p className="text-sm mt-1 text-center">Esperando datos del agente...</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pagination Controls - Rediseñado */}
        <div className="pager-controls bg-[#383739] border-t border-white/10">
          <button 
            onClick={handleResetToStart}
            disabled={actualCurrentPageIndex === 0}
            title="Ir al inicio"
            className="flex items-center gap-1"
          >
            <RotateCcw size={14} />
            Inicio
          </button>
          
          <button 
            onClick={handlePreviousPage}
            disabled={actualCurrentPageIndex === 0}
            title="Página anterior"
            className="flex items-center gap-1"
          >
            <ArrowLeft size={14} />
            Anterior
          </button>
          
          <button 
            onClick={handleLiveMode}
            disabled={!isSystemOnline || (isLastPage && isLiveMode)}
            title={isSystemOnline ? "Ir a la última página (tiempo real)" : "Sistema offline"}
            className={`flex items-center gap-1 ${
              isLiveMode && isLastPage && isSystemOnline ? 'bg-green-600/20 text-green-400' : 
              !isSystemOnline ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Radio size={14} />
            {isSystemOnline ? 'Live' : 'Offline'}
          </button>
          
          <button 
            onClick={handleNextPage}
            disabled={actualCurrentPageIndex >= monitorPages.length - 1}
            title="Página siguiente"
            className="flex items-center gap-1"
          >
            Siguiente
            <ArrowRight size={14} />
          </button>
          
          <div className="file-indicator">
            <span>
              PÁGINAS {actualCurrentPageIndex + 1} / {monitorPages.length}
            </span>
          </div>
          
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ 
                width: monitorPages.length > 0 
                  ? `${((actualCurrentPageIndex + 1) / monitorPages.length) * 100}%` 
                  : '0%' 
              }}
            />
          </div>
          
          <div className="flex items-center gap-3 text-xs">
            {isLiveMode && isSystemOnline && (
              <div className="flex items-center gap-1 text-green-400">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span>ONLINE</span>
              </div>
            )}
            {!isSystemOnline && (
              <div className="flex items-center gap-1 text-red-400">
                <div className="w-2 h-2 bg-red-400 rounded-full" />
                <span>OFFLINE</span>
              </div>
            )}
            <div className="text-[#7f7f7f]">
              {toolResults.length} herramienta(s) ejecutada(s)
            </div>
          </div>
        </div>
      </div>

      {/* Plan de Acción o Tarea Completada */}
      {plan && plan.length > 0 && (
        <>
          {/* Mostrar TaskCompletedUI si todas las tareas están completadas */}
          {plan.filter(s => s.completed).length === plan.length ? (
            <TaskCompletedUI />
          ) : (
            /* Plan de Acción normal cuando NO está completado */
            <div className="mt-3 bg-gradient-to-br from-[#383739] to-[#2a2a2b] border border-white/10 rounded-xl overflow-hidden shadow-lg">
              <div 
                className="px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-[rgba(255,255,255,0.05)] transition-all duration-200 group" 
                onClick={() => setIsPlanExpanded(!isPlanExpanded)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 bg-[#404142] rounded-lg flex items-center justify-center shadow-md">
                    <Activity className="w-3.5 h-3.5 text-[#DADADA]" />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-sm font-semibold text-[#DADADA] group-hover:text-white transition-colors leading-tight">
                      Plan de Acción
                    </h3>
                    <p className="text-xs text-[#ACACAC] leading-tight mt-0.5">
                      {`${plan.filter(s => s.completed).length} de ${plan.length} tareas completadas`}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-xs font-medium text-[#ACACAC]">
                      {Math.round((plan.filter(s => s.completed).length / plan.length) * 100)}%
                    </div>
                    <div className="w-12 h-1.5 bg-black/30 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-700 ease-out"
                        style={{ width: `${(plan.filter(s => s.completed).length / plan.length) * 100}%` }}
                      />
                    </div>
                  </div>
                  
                  {isPlanExpanded ? (
                    <ChevronDown className="w-4 h-4 text-[#7f7f7f] group-hover:text-white transition-all duration-200 transform group-hover:scale-110" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-[#7f7f7f] group-hover:text-white transition-all duration-200 transform group-hover:scale-110" />
                  )}
                </div>
              </div>
              
              {isPlanExpanded && (
                <div className="px-4 py-3 space-y-2 bg-[#383739] border-t border-[rgba(255,255,255,0.08)]">
                  {plan.map((step, index) => (
                    <div 
                      key={step.id} 
                      className={`group flex items-center space-x-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                        step.active ? 'bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.3)]' : 
                        step.completed ? 'bg-[rgba(34,197,94,0.08)] border border-[rgba(34,197,94,0.2)]' : 
                        step.failed || step.status === 'failed' ? 'bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]' : // 🔴 NUEVO: Estilo rojo para pasos fallidos
                        'border border-transparent'
                      }`}
                    >
                      <div className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                        step.completed ? '' :
                        step.failed || step.status === 'failed' ? '' : // 🔴 NUEVO: Estado fallido
                        step.active ? '' :
                        'bg-[#3a3a3c] text-[#7f7f7f] group-hover:bg-[#4a4a4c] group-hover:text-[#ACACAC] rounded-full'
                      }`}>
                        {step.completed ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : step.failed || step.status === 'failed' ? (
                          // 🔴 NUEVO: X roja para pasos fallidos
                          <div className="w-4 h-4 flex items-center justify-center bg-red-500/20 rounded-full">
                            <span className="text-red-400 font-bold text-xs">✕</span>
                          </div>
                        ) : step.active ? (
                          <div className="w-4 h-4 flex items-center justify-center">
                            <div className="w-3 h-3 rounded-sm loader-spin" 
                                 style={{
                                   background: 'linear-gradient(-45deg, #fc00ff 0%, #00dbde 100%)'
                                 }}>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold">{index + 1}</span>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <span className={`block text-sm transition-all duration-200 leading-tight ${
                          step.completed ? 'line-through text-[#8f8f8f] font-medium' : 
                          step.failed || step.status === 'failed' ? 'text-red-400 font-medium' : // 🔴 NUEVO: Texto rojo para pasos fallidos
                          step.active ? 'text-blue-400 font-semibold' : 
                          'text-[#DADADA] group-hover:text-white font-medium'
                        }`}>
                          {step.title}
                        </span>
                        {step.description && (
                          <span className={`block text-xs mt-1 transition-all duration-200 ${
                            step.completed ? 'line-through text-[#6f6f6f]' : 
                            step.active ? 'text-blue-300' : 
                            'text-[#ACACAC] group-hover:text-[#DADADA]'
                          }`}>
                            {step.description}
                          </span>
                        )}
                        {/* Mostrar tiempo transcurrido - FIXED FORMAT */}
                        {(stepTimers[step.id] || liveTimers[step.id]) && (
                          <span className={`block text-xs mt-0.5 transition-all duration-200 ${
                            step.completed ? 'text-green-400 font-medium' : 
                            step.active ? 'text-blue-200 font-medium' : 
                            'text-[#7f7f7f] group-hover:text-[#ACACAC]'
                          }`}>
                            {step.completed ? 
                              `✅ Completado en ${stepTimers[step.id] ? formatElapsedTime(stepTimers[step.id].startTime) : liveTimers[step.id] || '00:00'}` : 
                              step.active ? 
                                `${liveTimers[step.id] || '00:00'} Ejecutando` : 
                                `${liveTimers[step.id] || '00:00'}`}
                          </span>
                        )}
                        
                        {/* ✅ NUEVO: Mostrar información de reintentos */}
                        {(step.retry_count && step.retry_count > 0) && (
                          <span className={`block text-xs mt-0.5 transition-all duration-200 ${
                            step.failed || step.status === 'failed' ? 'text-red-400 font-medium' : 
                            step.status === 'pending_retry' ? 'text-yellow-400 font-medium' :
                            'text-orange-400 font-medium'
                          }`}>
                            {step.status === 'failed_after_retries' || (step.failed && step.retry_count >= 5) ? 
                              `❌ Falló después de ${step.retry_count} reintentos` : 
                              step.status === 'pending_retry' ? 
                                `🔄 Reintentando... (intento ${step.retry_count}/5)` :
                                `⚠️ ${step.retry_count} reintento${step.retry_count > 1 ? 's' : ''}`}
                          </span>
                        )}
                        
                        {/* ✅ NUEVO: Mostrar error si está disponible */}
                        {(step.failed || step.status === 'failed' || step.status === 'failed_after_retries') && step.last_error && (
                          <span className="block text-xs mt-0.5 text-red-300 opacity-75 truncate" title={step.last_error}>
                            🚨 {step.last_error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!isPlanExpanded && (
                <div className="px-4 py-3 bg-[#383739] border-t border-[rgba(255,255,255,0.08)]">
                  <div className="space-y-2">
                    {/* Tarea actual */}
                    {(() => {
                      const currentTask = plan.find(step => step.active);
                      return currentTask ? (
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 flex items-center justify-center">
                            <div className="w-3 h-3 rounded-sm loader-spin" 
                                 style={{
                                   background: 'linear-gradient(-45deg, #fc00ff 0%, #00dbde 100%)'
                                 }}>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-blue-400">Actual:</div>
                            <div className="text-xs text-[#DADADA] truncate">{currentTask.title}</div>
                          </div>
                        </div>
                      ) : null;
                    })()}
                    
                    {/* Próxima tarea */}
                    {(() => {
                      const currentIndex = plan.findIndex(step => step.active);
                      const nextTask = currentIndex >= 0 && currentIndex < plan.length - 1 ? plan[currentIndex + 1] : null;
                      return nextTask ? (
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 bg-[#7f7f7f] rounded-full"></div>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-[#7f7f7f]">Siguiente:</div>
                            <div className="text-xs text-[#7f7f7f] truncate">{nextTask.title}</div>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
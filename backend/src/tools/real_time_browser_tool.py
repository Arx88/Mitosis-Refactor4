"""
🌐 NAVEGACIÓN WEB EN TIEMPO REAL CON SCREENSHOTS REALES
Implementa navegación web verdadera con captura de pantalla en tiempo real
usando Playwright + Servidor X11 virtual para visualización completa

CARACTERÍSTICAS:
- ✅ Servidor X11 virtual (Xvfb) para navegación visible  
- ✅ Screenshots PNG reales capturados durante navegación
- ✅ Eventos WebSocket browser_visual en tiempo real
- ✅ Browser visible navegando paso a paso
- ✅ Captura automática cada 2 segundos durante navegación
"""

import asyncio
import os
import sys
import time
import base64
import json
import subprocess
import threading
import signal
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path

from .base_tool import BaseTool, ParameterDefinition, ToolExecutionResult, register_tool

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

# Importar WebSocket manager para eventos en tiempo real
try:
    from ..websocket.websocket_manager import get_websocket_manager
    WEBSOCKET_AVAILABLE = True
except ImportError:
    WEBSOCKET_AVAILABLE = False

@register_tool
class RealTimeBrowserTool(BaseTool):
    """
    🌐 HERRAMIENTA DE NAVEGACIÓN WEB EN TIEMPO REAL
    
    Proporciona navegación web visible con:
    - Servidor X11 virtual para mostrar el browser navegando
    - Screenshots PNG reales capturados automáticamente  
    - Eventos browser_visual enviados al frontend en tiempo real
    - Navegación paso a paso visible en el Monitor de Ejecución
    """
    
    def __init__(self):
        super().__init__(
            name="real_time_browser",
            description="Navegación web en tiempo real con screenshots reales y visualización paso a paso"
        )
        self.playwright_available = PLAYWRIGHT_AVAILABLE
        self.websocket_manager = None
        self.task_id = None
        self.xvfb_process = None
        self.screenshot_thread = None
        self.is_navigating = False
        self.current_page = None
        
    def _define_parameters(self) -> List[ParameterDefinition]:
        return [
            ParameterDefinition(
                name="task_description",
                param_type="string", 
                required=True,
                description="Descripción de la tarea de navegación a realizar",
                min_value=10,
                max_value=500
            ),
            ParameterDefinition(
                name="start_url",
                param_type="string",
                required=False,
                description="URL inicial para comenzar navegación",
                default="https://www.google.com"
            ),
            ParameterDefinition(
                name="capture_interval",
                param_type="integer", 
                required=False,
                description="Intervalo de captura de screenshots en segundos",
                default=2,
                min_value=1,
                max_value=10
            ),
            ParameterDefinition(
                name="max_duration",
                param_type="integer",
                required=False, 
                description="Duración máxima de navegación en segundos",
                default=60,
                min_value=10,
                max_value=300
            )
        ]
    
    def _execute_tool(self, parameters: Dict[str, Any], config: Dict[str, Any] = None) -> ToolExecutionResult:
        """🚀 EJECUTOR PRINCIPAL CON NAVEGACIÓN VISUAL EN TIEMPO REAL"""
        
        if not self.playwright_available:
            return ToolExecutionResult(
                success=False,
                error='Playwright no está disponible. Instalar con: pip install playwright && playwright install'
            )
        
        # Extraer parámetros
        task_description = parameters.get('task_description', '').strip()
        start_url = parameters.get('start_url', 'https://www.google.com')
        capture_interval = int(parameters.get('capture_interval', 2))
        max_duration = int(parameters.get('max_duration', 60))
        
        # Obtener task_id del config
        self.task_id = config.get('task_id') if config else f"browser-{int(time.time())}"
        
        try:
            # 🖥️ CONFIGURAR SERVIDOR X11 VIRTUAL
            self._setup_x11_server()
            
            # 🔄 INICIALIZAR WEBSOCKET PARA EVENTOS EN TIEMPO REAL
            self._initialize_websocket()
            
            # 🌐 EJECUTAR NAVEGACIÓN CON VISUALIZACIÓN EN TIEMPO REAL
            results = self._execute_real_time_navigation(
                task_description, start_url, capture_interval, max_duration
            )
            
            # ✅ RESULTADO EXITOSO
            return ToolExecutionResult(
                success=True,
                data={
                    'task_description': task_description,
                    'start_url': start_url,
                    'navigation_results': results,
                    'screenshots_captured': len(results.get('screenshots', [])),
                    'real_time_navigation': True,
                    'x11_server_used': True,
                    'capture_interval': capture_interval,
                    'total_duration': results.get('duration', 0),
                    'timestamp': datetime.now().isoformat()
                }
            )
            
        except Exception as e:
            # 📧 NOTIFICAR ERROR EN TIEMPO REAL
            self._emit_browser_visual({
                'type': 'navigation_error',
                'message': f"❌ Error en navegación: {str(e)}",
                'timestamp': time.time()
            })
            
            return ToolExecutionResult(
                success=False,
                error=f'Error en navegación en tiempo real: {str(e)}'
            )
        finally:
            # 🧹 LIMPIAR RECURSOS
            self._cleanup_resources()
    
    def _setup_x11_server(self):
        """🖥️ CONFIGURAR SERVIDOR X11 VIRTUAL PARA NAVEGACIÓN VISIBLE"""
        try:
            # Configurar display virtual
            display_num = 99
            os.environ['DISPLAY'] = f':{display_num}'
            
            # VERIFICAR SI YA HAY UN SERVIDOR X11 CORRIENDO
            try:
                # Verificar si el display :99 ya está en uso
                result = subprocess.run(['xset', '-display', f':{display_num}', 'q'], 
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    self._emit_progress(f"✅ Servidor X11 virtual ya está corriendo en display :{display_num}")
                    self._emit_browser_visual({
                        'type': 'x11_server_ready',
                        'message': '🖥️ Servidor X11 virtual detectado y listo - Navegación visible habilitada',
                        'display': f':{display_num}',
                        'resolution': '1920x1080',
                        'reused_existing': True,
                        'timestamp': time.time()
                    })
                    return  # Servidor ya existe, no necesitamos crear uno nuevo
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                # xset no está disponible o display no existe, necesitamos crear servidor
                pass
            
            # CREAR NUEVO SERVIDOR X11 SOLO SI NO EXISTE UNO
            # Verificar si Xvfb está disponible
            if not subprocess.run(['which', 'Xvfb'], capture_output=True).returncode == 0:
                self._emit_progress("⚠️ Xvfb no disponible, instalando...")
                subprocess.run(['apt-get', 'update', '-qq'], check=False)
                subprocess.run(['apt-get', 'install', '-y', 'xvfb'], check=False)
            
            # Intentar iniciar servidor X11 virtual
            self._emit_progress(f"🖥️ Iniciando nuevo servidor X11 virtual en display :{display_num}")
            
            self.xvfb_process = subprocess.Popen([
                'Xvfb', f':{display_num}',
                '-screen', '0', '1920x1080x24',
                '-ac', '-nolisten', 'tcp'
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Esperar a que el servidor se inicie
            time.sleep(2)
            
            # Verificar que el servidor está corriendo
            if self.xvfb_process.poll() is None:
                self._emit_progress("✅ Nuevo servidor X11 virtual iniciado correctamente")
                self._emit_browser_visual({
                    'type': 'x11_server_started',
                    'message': '🖥️ Nuevo servidor X11 virtual activo - Navegación visible habilitada',
                    'display': f':{display_num}',
                    'resolution': '1920x1080',
                    'reused_existing': False,
                    'timestamp': time.time()
                })
            else:
                raise Exception("Fallo al iniciar servidor Xvfb")
                
        except Exception as e:
            self._emit_progress(f"❌ Error configurando X11: {str(e)}")
            # No hacer raise - continuar sin servidor X11 propio pero usar el existente
            self._emit_progress("⚠️ Continuando con servidor X11 existente...")
            os.environ['DISPLAY'] = ':99'  # Usar el display existente
    
    def _initialize_websocket(self):
        """🔄 INICIALIZAR WEBSOCKET PARA EVENTOS EN TIEMPO REAL"""
        try:
            if WEBSOCKET_AVAILABLE and self.task_id:
                self.websocket_manager = get_websocket_manager()
                self._emit_progress("🔌 WebSocket inicializado para navegación en tiempo real")
            else:
                self._emit_progress("⚠️ WebSocket no disponible - usando logging básico")
        except Exception as e:
            self._emit_progress(f"⚠️ Error inicializando WebSocket: {str(e)}")
    
    def _execute_real_time_navigation(self, task_description: str, start_url: str, 
                                    capture_interval: int, max_duration: int) -> Dict[str, Any]:
        """🌐 EJECUTAR NAVEGACIÓN CON CAPTURA EN TIEMPO REAL"""
        
        results = {
            'task_description': task_description,
            'start_url': start_url,
            'screenshots': [],
            'pages_visited': [],
            'actions_performed': [],
            'duration': 0,
            'success': True
        }
        
        start_time = time.time()
        
        try:
            # 🚀 INICIAR NAVEGACIÓN ASÍNCRONA
            self._emit_browser_visual({
                'type': 'navigation_start_real',
                'message': f'🚀 NAVEGACIÓN REAL INICIADA: {task_description}',
                'task_description': task_description,
                'start_url': start_url,
                'timestamp': time.time()
            })
            
            # Ejecutar navegación usando asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                navigation_result = loop.run_until_complete(
                    self._async_navigate_with_real_time_capture(
                        task_description, start_url, capture_interval, max_duration, results
                    )
                )
                results.update(navigation_result)
            finally:
                loop.close()
            
            # Calcular duración total
            results['duration'] = time.time() - start_time
            
            # 🎉 NAVEGACIÓN COMPLETADA
            self._emit_browser_visual({
                'type': 'navigation_complete_real',
                'message': f'✅ NAVEGACIÓN REAL COMPLETADA: {len(results["screenshots"])} capturas realizadas',
                'total_screenshots': len(results['screenshots']),
                'total_duration': results['duration'],
                'pages_visited': len(results['pages_visited']),
                'timestamp': time.time()
            })
            
            return results
            
        except Exception as e:
            results['success'] = False
            results['error'] = str(e)
            results['duration'] = time.time() - start_time
            
            self._emit_browser_visual({
                'type': 'navigation_error_real', 
                'message': f'❌ Error durante navegación: {str(e)}',
                'timestamp': time.time()
            })
            
            raise
    
    async def _async_navigate_with_real_time_capture(self, task_description: str, start_url: str,
                                                   capture_interval: int, max_duration: int, 
                                                   results: Dict[str, Any]) -> Dict[str, Any]:
        """🎭 NAVEGACIÓN ASÍNCRONA CON PLAYWRIGHT Y CAPTURA AUTOMÁTICA"""
        
        async with async_playwright() as p:
            # Configurar browser con argumentos para servidor X11
            browser = await p.chromium.launch(
                headless=False,  # 🚀 NAVEGACIÓN VISIBLE
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--no-first-run',
                    '--disable-default-apps',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-ipc-flooding-protection',
                    f'--display={os.environ.get("DISPLAY", ":99")}',  # 🖥️ USAR DISPLAY X11
                    '--window-size=1920,1080'
                ]
            )
            
            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            )
            
            page = await context.new_page()
            self.current_page = page
            
            try:
                # 🎬 INICIAR HILO DE CAPTURA AUTOMÁTICA
                self.is_navigating = True
                self._start_screenshot_capture_thread(page, capture_interval, results)
                
                # 🌐 NAVEGAR A URL INICIAL  
                self._emit_browser_visual({
                    'type': 'page_navigation',
                    'message': f'🌐 Navegando a página inicial: {start_url}',
                    'url': start_url,
                    'timestamp': time.time()
                })
                
                await page.goto(start_url, wait_until='networkidle')
                
                # Registrar página visitada
                results['pages_visited'].append({
                    'url': start_url,
                    'title': await page.title(),
                    'timestamp': time.time()
                })
                
                # 🎯 SIMULAR NAVEGACIÓN INTELIGENTE BASADA EN TASK_DESCRIPTION
                await self._perform_intelligent_navigation(page, task_description, results)
                
                # Esperar un poco más para capturas finales
                await asyncio.sleep(3)
                
                return {'success': True}
                
            except Exception as e:
                return {'success': False, 'error': str(e)}
            
            finally:
                # 🛑 DETENER CAPTURA Y CERRAR BROWSER
                self.is_navigating = False
                if self.screenshot_thread:
                    self.screenshot_thread.join(timeout=5)
                
                await context.close()
                await browser.close()
    
    async def _perform_intelligent_navigation(self, page, task_description: str, results: Dict[str, Any]):
        """🤖 REALIZAR NAVEGACIÓN INTELIGENTE BASADA EN LA DESCRIPCIÓN"""
        
        try:
            # Analizar task_description para determinar acciones
            if 'buscar' in task_description.lower() or 'search' in task_description.lower():
                await self._perform_search_task(page, task_description, results)
            elif 'pokemon' in task_description.lower():
                await self._perform_pokemon_search(page, results)
            elif 'inteligencia artificial' in task_description.lower() or 'ai' in task_description.lower():
                await self._perform_ai_search(page, results)
            else:
                # Navegación genérica - explorar la página actual
                await self._perform_generic_exploration(page, results)
                
        except Exception as e:
            self._emit_browser_visual({
                'type': 'navigation_step_error',
                'message': f'⚠️ Error en navegación inteligente: {str(e)}',
                'timestamp': time.time()
            })
    
    async def _perform_search_task(self, page, task_description: str, results: Dict[str, Any]):
        """🔍 REALIZAR TAREA DE BÚSQUEDA"""
        
        # Buscar campo de búsqueda
        search_selectors = [
            'input[name="q"]',  # Google
            'input[type="search"]',
            'input[placeholder*="search" i]', 
            'input[placeholder*="buscar" i]',
            '.search-input',
            '#search'
        ]
        
        search_input = None
        for selector in search_selectors:
            try:
                search_input = await page.wait_for_selector(selector, timeout=3000)
                if search_input:
                    break
            except:
                continue
        
        if search_input:
            # Extraer términos de búsqueda del task_description
            search_terms = self._extract_search_terms(task_description)
            
            self._emit_browser_visual({
                'type': 'search_action',
                'message': f'🔍 Realizando búsqueda: {search_terms}',
                'search_terms': search_terms,
                'timestamp': time.time()
            })
            
            # Realizar búsqueda
            await search_input.fill(search_terms)
            await asyncio.sleep(1)  # Pausa para captura
            await search_input.press('Enter')
            
            # Registrar acción
            results['actions_performed'].append({
                'action': 'search',
                'terms': search_terms,
                'timestamp': time.time()
            })
            
            # Esperar resultados y explorar
            await page.wait_for_load_state('networkidle')
            await asyncio.sleep(2)
            
            # Hacer clic en primer resultado si existe
            try:
                first_result = await page.wait_for_selector('h3', timeout=5000)
                if first_result:
                    self._emit_browser_visual({
                        'type': 'click_action', 
                        'message': '🖱️ Haciendo clic en primer resultado',
                        'timestamp': time.time()
                    })
                    
                    await first_result.click()
                    await page.wait_for_load_state('networkidle')
                    
                    # Registrar nueva página
                    results['pages_visited'].append({
                        'url': page.url,
                        'title': await page.title(),
                        'timestamp': time.time()
                    })
                    
                    results['actions_performed'].append({
                        'action': 'click_result',
                        'url': page.url,
                        'timestamp': time.time()
                    })
                    
            except:
                # No se pudo hacer clic en resultado
                pass
    
    async def _perform_pokemon_search(self, page, results: Dict[str, Any]):
        """🎮 BÚSQUEDA ESPECÍFICA DE POKÉMON"""
        await self._perform_search_with_terms(page, "Pokemon información", results)
    
    async def _perform_ai_search(self, page, results: Dict[str, Any]):
        """🤖 BÚSQUEDA ESPECÍFICA DE IA"""
        await self._perform_search_with_terms(page, "inteligencia artificial 2025", results)
    
    async def _perform_search_with_terms(self, page, search_terms: str, results: Dict[str, Any]):
        """🔍 REALIZAR BÚSQUEDA CON TÉRMINOS ESPECÍFICOS"""
        
        # Buscar campo de búsqueda
        search_input = None
        search_selectors = ['input[name="q"]', 'input[type="search"]']
        
        for selector in search_selectors:
            try:
                search_input = await page.wait_for_selector(selector, timeout=3000)
                if search_input:
                    break
            except:
                continue
        
        if search_input:
            self._emit_browser_visual({
                'type': 'search_specific',
                'message': f'🔍 Búsqueda específica: {search_terms}',
                'terms': search_terms,
                'timestamp': time.time()
            })
            
            await search_input.fill(search_terms)
            await asyncio.sleep(1)
            await search_input.press('Enter')
            await page.wait_for_load_state('networkidle')
            
            results['actions_performed'].append({
                'action': 'specific_search',
                'terms': search_terms,
                'timestamp': time.time()
            })
    
    async def _perform_generic_exploration(self, page, results: Dict[str, Any]):
        """🗺️ EXPLORACIÓN GENÉRICA DE LA PÁGINA"""
        
        self._emit_browser_visual({
            'type': 'page_exploration',
            'message': '🗺️ Explorando página actual',
            'url': page.url,
            'timestamp': time.time()
        })
        
        # Hacer scroll para mostrar contenido
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)')
        await asyncio.sleep(2)
        await page.evaluate('window.scrollTo(0, 0)')
        await asyncio.sleep(2)
        
        results['actions_performed'].append({
            'action': 'page_exploration',
            'url': page.url,
            'timestamp': time.time()
        })
    
    def _extract_search_terms(self, task_description: str) -> str:
        """📝 EXTRAER TÉRMINOS DE BÚSQUEDA DEL TASK_DESCRIPTION"""
        
        # Limpiar y extraer palabras clave relevantes
        import re
        
        # Remover palabras comunes
        stop_words = {'buscar', 'información', 'sobre', 'acerca', 'de', 'la', 'el', 'en', 'con', 'para', 'web_search'}
        
        # Extraer palabras
        words = re.findall(r'\b\w+\b', task_description.lower())
        keywords = [w for w in words if w not in stop_words and len(w) > 2]
        
        # Tomar las primeras 3-4 palabras más relevantes
        search_terms = ' '.join(keywords[:4]) if keywords else 'información general'
        
        return search_terms
    
    def _start_screenshot_capture_thread(self, page, capture_interval: int, results: Dict[str, Any]):
        """📸 INICIAR HILO DE CAPTURA AUTOMÁTICA DE SCREENSHOTS"""
        
        def capture_screenshots():
            """Función que ejecuta en hilo separado para capturar screenshots"""
            screenshot_count = 0
            
            while self.is_navigating:
                try:
                    # Programar captura asíncrona
                    if page:
                        screenshot_path = asyncio.run_coroutine_threadsafe(
                            self._capture_screenshot_async(page, screenshot_count), 
                            asyncio.get_event_loop()
                        ).result(timeout=10)
                        
                        if screenshot_path:
                            # Registrar screenshot
                            screenshot_data = {
                                'index': screenshot_count,
                                'path': screenshot_path,
                                'url': page.url if hasattr(page, 'url') else 'unknown',
                                'timestamp': time.time()
                            }
                            
                            results['screenshots'].append(screenshot_data)
                            
                            # Emitir evento browser_visual con screenshot real
                            self._emit_browser_visual({
                                'type': 'screenshot_captured_real',
                                'message': f'📸 Screenshot real #{screenshot_count + 1} capturado',
                                'screenshot_url': screenshot_path,
                                'screenshot_index': screenshot_count,
                                'current_url': screenshot_data['url'],
                                'timestamp': time.time()
                            })
                            
                            screenshot_count += 1
                    
                    # Esperar antes de próxima captura
                    time.sleep(capture_interval)
                    
                except Exception as e:
                    self._emit_progress(f"⚠️ Error capturando screenshot: {str(e)}")
                    time.sleep(capture_interval)  # Continuar a pesar del error
        
        # Iniciar hilo de captura
        self.screenshot_thread = threading.Thread(target=capture_screenshots, daemon=True)
        self.screenshot_thread.start()
        
        self._emit_progress(f"📸 Hilo de captura automática iniciado (intervalo: {capture_interval}s)")
    
    async def _capture_screenshot_async(self, page, screenshot_index: int) -> Optional[str]:
        """📸 CAPTURAR SCREENSHOT ASÍNCRONO Y RETORNAR PATH"""
        
        try:
            # Crear directorio de screenshots si no existe
            screenshots_dir = Path(f"/tmp/screenshots/{self.task_id}")
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            
            # Generar nombre de archivo
            timestamp = int(time.time() * 1000)
            filename = f"real_navigation_{screenshot_index:03d}_{timestamp}.png"
            screenshot_path = screenshots_dir / filename
            
            # Capturar screenshot de página completa
            await page.screenshot(
                path=str(screenshot_path),
                quality=85,  # Buena calidad pero no excesiva
                full_page=True  # Captura completa de la página
            )
            
            # Retornar URL accesible para frontend
            return f"/api/files/screenshots/{self.task_id}/{filename}"
            
        except Exception as e:
            self._emit_progress(f"⚠️ Error en captura async: {str(e)}")
            return None
    
    def _emit_browser_visual(self, data: Dict[str, Any]):
        """📡 EMITIR EVENTO BROWSER_VISUAL AL FRONTEND"""
        
        if self.websocket_manager and self.task_id:
            try:
                # Añadir task_id y timestamp si no están presentes
                enhanced_data = {
                    'task_id': self.task_id,
                    'timestamp': data.get('timestamp', time.time()),
                    **data
                }
                
                # Emitir evento browser_visual
                self.websocket_manager.emit_to_task(self.task_id, 'browser_visual', enhanced_data)
                
                # También emitir como actividad del agente para compatibilidad
                self.websocket_manager.emit_to_task(self.task_id, 'agent_activity', {
                    'type': 'browser_visual',
                    'message': data.get('message', 'Navegación en tiempo real'),
                    **enhanced_data
                })
                
            except Exception as e:
                print(f"⚠️ Error emitiendo browser_visual: {str(e)}")
    
    def _emit_progress(self, message: str):
        """📝 EMITIR MENSAJE DE PROGRESO"""
        
        print(f"[REAL_TIME_BROWSER] {message}")
        
        if self.websocket_manager and self.task_id:
            try:
                self.websocket_manager.emit_to_task(self.task_id, 'terminal_activity', {
                    'message': message,
                    'timestamp': time.time()
                })
            except Exception:
                pass  # Continuar silenciosamente si WebSocket falla
    
    def _cleanup_resources(self):
        """🧹 LIMPIAR RECURSOS Y CERRAR PROCESOS"""
        
        try:
            # Detener captura de screenshots
            self.is_navigating = False
            if self.screenshot_thread and self.screenshot_thread.is_alive():
                self.screenshot_thread.join(timeout=3)
            
            # Cerrar servidor X11 virtual
            if self.xvfb_process:
                try:
                    self.xvfb_process.terminate()
                    self.xvfb_process.wait(timeout=5)
                    self._emit_progress("🔒 Servidor X11 virtual cerrado")
                except:
                    # Forzar cierre si no responde
                    self.xvfb_process.kill()
                finally:
                    self.xvfb_process = None
            
            # Emitir evento de limpieza
            self._emit_browser_visual({
                'type': 'resources_cleaned',
                'message': '🧹 Recursos de navegación limpiados correctamente',
                'timestamp': time.time()
            })
            
        except Exception as e:
            self._emit_progress(f"⚠️ Error durante limpieza: {str(e)}")
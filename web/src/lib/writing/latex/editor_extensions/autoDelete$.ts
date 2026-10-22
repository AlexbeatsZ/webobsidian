import type { EditorView } from '@codemirror/view';
import { getLatexSuiteConfig } from '../snippets/codemirror/config';
export function autoDelete$(view:EditorView){
  if(view.state.readOnly||view.composing||!getLatexSuiteConfig(view).autoDelete$)return false;
  const s=view.state.selection.main;if(!s.empty)return false;
  const left=view.state.sliceDoc(Math.max(0,s.head-2),s.head),right=view.state.sliceDoc(s.head,s.head+2);
  if(left.endsWith('$')&&right.startsWith('$')){view.dispatch({changes:{from:s.head-1,to:s.head+1},userEvent:'delete.backward'});return true;}
  if(left==='$ {'||right==='')return false;
  if(view.state.sliceDoc(Math.max(0,s.head-3),s.head+1)==='${}$'){
    view.dispatch({changes:{from:s.head-3,to:s.head+1},userEvent:'delete.backward'});return true;
  }return false;
}

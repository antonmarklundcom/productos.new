import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {LoginForm} from './login-form';
vi.mock('@/app/actions/admin-auth',()=>({loginAdmin:vi.fn(async()=>({error:'Error de acceso'}))}));
vi.mock('next/link',()=>({default:(props:React.ComponentProps<'a'>)=><a {...props}/> }));
afterEach(cleanup);
it('password visibility toggle preserves value/autocomplete and never submits',()=>{
 render(<LoginForm next="/admin"/>);const input=screen.getByLabelText('Contraseña');fireEvent.change(input,{target:{value:'example'}});
 const toggle=screen.getByRole('button',{name:'Mostrar contraseña'});expect(toggle).toHaveAttribute('type','button');fireEvent.click(toggle);
 expect(input).toHaveAttribute('type','text');expect(input).toHaveValue('example');expect(input).toHaveAttribute('autocomplete','current-password');expect(toggle).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Ocultar contraseña'}));expect(input).toHaveAttribute('type','password');
});
it('recovery is linked only where the Worker handles it',()=>{
 const view=render(<LoginForm next="/admin"/>);expect(screen.queryByText('¿Olvidaste tu contraseña?')).toBeNull();view.rerender(<LoginForm next="/admin" passwordRecoveryAvailable/>);
 expect(screen.getByRole('link',{name:'¿Olvidaste tu contraseña?'})).toHaveAttribute('href','/admin/recuperar');
});
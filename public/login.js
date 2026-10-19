const password=document.getElementById('password'),toggle=document.getElementById('togglePassword');
document.getElementById('loginError').hidden=new URLSearchParams(location.search).get('error')!=='1';
toggle.onclick=()=>{password.type=password.type==='password'?'text':'password';toggle.setAttribute('aria-label',password.type==='password'?'Mostrar senha':'Ocultar senha');};

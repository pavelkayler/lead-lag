import { Toast, ToastContainer } from 'react-bootstrap';

export function Toasts({ toasts, remove }) {
  return (
    <ToastContainer position="bottom-end" className="p-3">
      {toasts.map((t) => (
        <Toast key={t.id} bg={t.variant || 'dark'} onClose={() => remove(t.id)} delay={3000} autohide>
          <Toast.Body className="text-white">{t.text}</Toast.Body>
        </Toast>
      ))}
    </ToastContainer>
  );
}

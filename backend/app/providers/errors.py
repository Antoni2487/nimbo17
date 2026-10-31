class ProviderError(Exception):
    """Falla de un proveedor externo (STT, LLM o TTS).

    `user_message` es lo que verá el usuario (en español, entendible).
    El detalle técnico va en el mensaje de la excepción y en los logs.
    """

    def __init__(self, provider: str, user_message: str, detail: str = "") -> None:
        super().__init__(f"[{provider}] {detail or user_message}")
        self.provider = provider
        self.user_message = user_message
